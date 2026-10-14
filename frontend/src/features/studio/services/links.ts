// Where the program and its author live on the web.
const REPO = 'https://github.com/timoncool/videosos'

export const LINKS = {
  repo: REPO,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
  license: `${REPO}/blob/main/LICENSE`,
}

/**
 * GitHub's choice of forms (bug, idea, question) with what VideoSOS knows filled in: the keys are the `id`s of the
 * text fields in `.github/ISSUE_TEMPLATE/*.yml`.
 */
export function issueReportUrl(known: { version: string; gpu?: string | null; os?: string | null }): string {
  const query = new URLSearchParams({ version: known.version })
  if (known.gpu) query.set('gpu', known.gpu)
  if (known.os) query.set('os', known.os)
  return `${REPO}/issues/new/choose?${query.toString()}`
}

export const DONATE = {
  boosty: 'https://boosty.to/neuro_art',
  dalink: 'https://dalink.to/nerual_dreming',
  github: REPO,
  telegram: 'https://t.me/nerual_dreming',
  crypto: [
    ['BTC', '1E7dHL22RpyhJGVpcvKdbyZgksSYkYeEBC'],
    ['ETH · ERC20', '0xb5db65adf478983186d4897ba92fe2c25c594a0c'],
    ['USDT · TRC20', 'TQST9Lp2TjK6FiVkn4fwfGUee7NmkxEE7C'],
  ] as const,
}
