// THT token configuration - policy ID must be exactly 56 hex characters (28 bytes)
export const THT = {
  // Policy ID should be 56 hex chars. Update via VITE_THT_POLICY_ID env var when THT is deployed.
  // Query deployed policy: curl "https://preprod.koios.rest/api/v1/asset_list?_asset_name=544854"
  policyId: import.meta.env.VITE_THT_POLICY_ID ?? "00000000000000000000000000000000000000000000000000", // PLACEHOLDER - 28 bytes
  name: "THT",
  symbol: "THT",
  ticker: "THT",
  label: (amount: string | number) => `${amount} THT`,
} as const;
