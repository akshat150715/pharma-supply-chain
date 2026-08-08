import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PharmaSupplyChainModule = buildModule(
  "PharmaSupplyChainModule",
  (m) => {

    const pharmaSupplyChain = m.contract(
      "PharmaSupplyChain"
    );

    return {
      pharmaSupplyChain,
    };
  }
);

export default PharmaSupplyChainModule;