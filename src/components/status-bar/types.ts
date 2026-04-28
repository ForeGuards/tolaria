export interface VaultOption {
  label: string
  path: string
  available?: boolean
  /** Unix timestamp in ms of the last time this vault was made active. */
  lastOpenedAt?: number | null
}
