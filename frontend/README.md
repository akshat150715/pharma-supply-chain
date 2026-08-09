# Pharma Supply Chain Frontend

## Run locally

```powershell
npm install
npm run dev
```

Without environment variables, the app connects to the local Hardhat network
(`127.0.0.1:8545`, chain ID `31337`). Start the local Hardhat node and deploy
the contract before using it in this mode.

## Publish a working demo with Vercel

The contract must be deployed to a public network first. Deploy
`../blockchain/ignition/modules/PharmaSupplyChain.ts` to Sepolia, then use the
address printed by Hardhat.

In the Vercel project, open **Settings → Environment Variables** and add these
values for the Production environment:

| Name | Value |
| --- | --- |
| `VITE_CONTRACT_ADDRESS` | The deployed Sepolia contract address |
| `VITE_NETWORK_CHAIN_ID` | `11155111` |
| `VITE_NETWORK_NAME` | `Sepolia` |

Redeploy after saving them. The variables are compiled into the frontend, so
they are suitable only for public settings. Never add a wallet private key,
seed phrase, or RPC-provider secret to Vercel or this repository.

Visitors need MetaMask set to Sepolia. The wallet that deployed the contract is
the admin and retains permission to register participants.
