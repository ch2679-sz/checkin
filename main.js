const GLaDOS_API = 'https://glados.cloud'
const CHECKIN_URL = `${GLaDOS_API}/api/user/checkin`
const STATUS_URL = `${GLaDOS_API}/api/user/status`
const CONSOLE_URL = 'https://glados.cloud/console/checkin'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 判断返回信息是否表示 Cookie / 登录状态失效
 */
const isCookieExpired = (status, data) => {
  const text = JSON.stringify(data || '').toLowerCase()

  return (
    status === 401 ||
    status === 403 ||
    text.includes('unauthorized') ||
    text.includes('not authorized') ||
    text.includes('login') ||
    text.includes('please login') ||
    text.includes('登录') ||
    text.includes('未登录') ||
    text.includes('cookie') ||
    text.includes('session')
  )
}

/**
 * 安全读取 JSON
 */
const fetchJson = async (url, options) => {
  const response = await fetch(url, options)

  let data = null

  try {
    data = await response.json()
  } catch {
    throw new Error(`API 返回的内容不是有效 JSON，HTTP ${response.status}`)
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.msg ||
      data?.error ||
      `HTTP ${response.status}`

    const error = new Error(message)
    error.httpStatus = response.status
    error.responseData = data
    throw error
  }

  return data
}

/**
 * 判断是否为“今天已经签到”
 */
const isRepeatCheckin = (data) => {
  const text = [
    data?.message,
    data?.msg,
    data?.data?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    text.includes('checkin repeats') ||
    text.includes('already checkin') ||
    text.includes('already checked') ||
    text.includes('already signed') ||
    text.includes('please try tomorrow') ||
    text.includes('重复签到') ||
    text.includes('今日已签到') ||
    text.includes('已经签到')
  )
}

/**
 * GLaDOS 签到
 */
const glados = async () => {
  const notice = []
  let hasError = false

  const cookies = String(process.env.GLADOS || '')
    .split('\n')
    .map((cookie) => cookie.trim())
    .filter(Boolean)

  if (cookies.length === 0) {
    notice.push(
      '❌ Checkin Error',
      'GLADOS Secret 未配置或为空',
      '请检查 GitHub Settings → Secrets and variables → Actions → GLADOS'
    )

    process.exitCode = 1
    return notice
  }

  for (const [index, cookie] of cookies.entries()) {
    try {
      const common = {
        cookie,
        referer: CONSOLE_URL,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      }

      console.log(`\n========== GLaDOS Account ${index + 1} ==========`)
      console.log('📡 正在执行签到...')

      let action

      try {
        action = await fetchJson(CHECKIN_URL, {
          method: 'POST',
          headers: {
            ...common,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token: 'glados.cloud',
          }),
        })
      } catch (error) {
        if (
          isCookieExpired(
            error?.httpStatus,
            error?.responseData || error?.message
          )
        ) {
          throw new Error(
            'GLaDOS Cookie 已失效或登录状态已过期，请重新获取 Cookie 并更新 GitHub Secret：GLADOS'
          )
        }

        throw new Error(`签到 API 请求失败：${error.message}`)
      }

      /*
       * GLaDOS 某些情况下会返回 code。
       * 但“重复签到”属于正常状态，不应判定为失败。
       */
      if (action?.code && !isRepeatCheckin(action)) {
        if (isCookieExpired(null, action)) {
          throw new Error(
            'GLaDOS Cookie 已失效或登录状态已过期，请重新获取 Cookie 并更新 GitHub Secret：GLADOS'
          )
        }

        throw new Error(
          `签到失败：${action?.message || action?.msg || JSON.stringify(action)}`
        )
      }

      let checkinMessage = action?.message || action?.msg || ''

      if (isRepeatCheckin(action)) {
        console.log('🔄 今日已经签到')
        console.log(`   ${checkinMessage || 'Checkin Repeats! Please Try Tomorrow'}`)

        notice.push(
          '🔄 今日已签到',
          checkinMessage || 'Checkin Repeats! Please Try Tomorrow'
        )
      } else {
        console.log('✅ 签到成功')
        console.log(`   ${checkinMessage || 'Checkin OK'}`)

        notice.push(
          '✅ Checkin OK',
          checkinMessage || '签到成功'
        )
      }

      /*
       * 签到后再次查询账户状态。
       */
      console.log('📊 正在获取账户状态...')

      let status

      try {
        status = await fetchJson(STATUS_URL, {
          method: 'GET',
          headers: common,
        })
      } catch (error) {
        if (
          isCookieExpired(
            error?.httpStatus,
            error?.responseData || error?.message
          )
        ) {
          throw new Error(
            'GLaDOS Cookie 已失效，签到后的账户状态验证失败，请重新获取 Cookie 并更新 GLADOS Secret'
          )
        }

        throw new Error(`账户状态 API 请求失败：${error.message}`)
      }

      if (status?.code) {
        if (isCookieExpired(null, status)) {
          throw new Error(
            'GLaDOS Cookie 已失效，账户状态查询失败，请重新获取 Cookie 并更新 GLADOS Secret'
          )
        }

        throw new Error(
          `账户状态查询失败：${status?.message || status?.msg || JSON.stringify(status)}`
        )
      }

      const leftDays = Number(status?.data?.leftDays)

      if (Number.isFinite(leftDays)) {
        console.log(`📅 剩余天数：${leftDays}`)

        notice.push(`📅 Left Days ${leftDays}`)
      } else {
        console.log('⚠️ 未能获取剩余天数')

        notice.push('⚠️ 未能获取账户剩余天数')
      }

      console.log('========================================')
    } catch (error) {
      hasError = true

      console.error('❌ GLaDOS 签到失败')
      console.error(`   ${error?.message || error}`)

      notice.push(
        '❌ Checkin Error',
        `${error?.message || error}`,
        `请检查：${CONSOLE_URL}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )

      console.log('========================================')
    }
  }

  /*
   * 非常重要：
   * 只要有任何一个账号失败，就让 GitHub Actions 最终显示 Failed。
   */
  if (hasError) {
    process.exitCode = 1
  }

  return notice
}

/**
 * 通知
 */
const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice || notice.length === 0) {
    return
  }

  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue

    try {
      if (option.startsWith('console:')) {
        for (const line of notice) {
          console.log(line)
        }
      }

      else if (option.startsWith('wxpusher:')) {
        await fetch('https://wxpusher.zjiecode.com/api/send/message', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            appToken: option.split(':')[1],
            summary: notice[0],
            content: notice.join('<br>'),
            contentType: 3,
            uids: option.split(':').slice(2),
          }),
        })
      }

      else if (option.startsWith('pushplus:')) {
        await fetch('https://www.pushplus.plus/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token: option.split(':')[1],
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      }

      else if (option.startsWith('qyweixin:')) {
        const qyweixinToken = option.split(':')[1]

        const qyweixinNotifyRebotUrl =
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' +
          qyweixinToken

        await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
              content: notice.join('<br>'),
            },
          }),
        })
      }

      else {
        // fallback：直接将 option 当作 PushPlus token
        await fetch('https://www.pushplus.plus/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token: option,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      }
    } catch (error) {
      /*
       * 通知失败不应该覆盖真正的签到结果。
       * 因此这里只记录通知错误，不修改 process.exitCode。
       */
      console.error(`⚠️ 通知发送失败：${error?.message || error}`)
    }
  }
}

const main = async () => {
  try {
    console.log('========================================')
    console.log('       GLaDOS Auto Check-in')
    console.log('========================================')

    const notice = await glados()

    if (notice && notice.length > 0) {
      await notify(notice)
    }

    /*
     * 如果 glados() 已经设置 process.exitCode = 1，
     * 这里不要覆盖它。
     */
    if (process.exitCode === 1) {
      console.error('\n❌ GLaDOS 签到任务失败')
    } else {
      console.log('\n✅ GLaDOS 签到任务完成')
    }
  } catch (error) {
    console.error('\n❌ 程序发生未处理异常')
    console.error(error)

    process.exitCode = 1
  }
}

main()
