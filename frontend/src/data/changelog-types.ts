export type ChangelogGroup = 'added' | 'fixed' | 'improved'

export type ChangelogItem = {
  title: string
}

export type ChangelogSubtitle = 'initialRelease'

export type ChangelogEntry = {
  version: string
  date: string
  subtitleKey?: ChangelogSubtitle
  groups: Partial<Record<ChangelogGroup, ChangelogItem[]>>
}

export type ChangelogFile = {
  current: ChangelogEntry | null
  releases: ChangelogEntry[]
}
