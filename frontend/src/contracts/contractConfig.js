// Vite exposes only variables prefixed with VITE_ to browser code. These
// values are public configuration, not secrets; never put a private key here.
//
// These Sepolia defaults make the shared hosted demo work immediately. Set
// VITE_CONTRACT_ADDRESS, VITE_NETWORK_CHAIN_ID, and VITE_NETWORK_NAME to
// override them for another deployment (such as a local Hardhat demo).
export const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ??
  "0xB2099e9D4D21534aA486661BAc6fa0660d61bc8D";

export const NETWORK_CHAIN_ID = Number(
  import.meta.env.VITE_NETWORK_CHAIN_ID ?? "11155111"
);

export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME ?? "Sepolia";
