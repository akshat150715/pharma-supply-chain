import { expect } from "chai";
import { network } from "hardhat";

describe("PharmaSupplyChain", async function () {

  const { ethers } = await network.connect();

  // Role enum values, matching the Solidity contract's Role enum order
  const Role = {
    None: 0,
    Manufacturer: 1,
    Distributor: 2,
    Pharmacy: 3,
    Regulator: 4,
  };

  const BatchStatus = {
    Created: 0,
    InTransit: 1,
    Sold: 2,
    Recalled: 3,
  };

  async function deployAndAssignRoles() {
    const [admin, manufacturer, distributor, pharmacy, consumer] =
      await ethers.getSigners();

    const PharmaSupplyChain =
      await ethers.getContractFactory("PharmaSupplyChain");

    const pharmaSupplyChain =
      await PharmaSupplyChain.deploy();

    await pharmaSupplyChain.waitForDeployment();

    // admin (deployer) is auto-assigned Role.Regulator in the constructor
    await pharmaSupplyChain.registerParticipant(
      manufacturer.address,
      Role.Manufacturer
    );

    await pharmaSupplyChain.registerParticipant(
      distributor.address,
      Role.Distributor
    );

    await pharmaSupplyChain.registerParticipant(
      pharmacy.address,
      Role.Pharmacy
    );

    return {
      pharmaSupplyChain,
      admin,
      manufacturer,
      distributor,
      pharmacy,
      consumer,
    };
  }

  it("Should register a medicine batch", async function () {

    const { pharmaSupplyChain, manufacturer } =
      await deployAndAssignRoles();

    await pharmaSupplyChain
      .connect(manufacturer)
      .registerMedicine(
        "Paracetamol",
        "PCM2026001",
        "ABC Pharma",
        1754524800,
        1817683200,
        10000
      );

    const medicine =
      await pharmaSupplyChain.getMedicine(1);

    expect(medicine.medicineName)
      .to.equal("Paracetamol");

    expect(medicine.batchNumber)
      .to.equal("PCM2026001");

    expect(medicine.manufacturerName)
      .to.equal("ABC Pharma");

    expect(medicine.quantity)
      .to.equal(10000);

    expect(medicine.exists)
      .to.equal(true);

    expect(medicine.currentOwner)
      .to.equal(manufacturer.address);

    expect(medicine.status)
      .to.equal(BatchStatus.Created);
  });


  it("Should count registered batches", async function () {

    const { pharmaSupplyChain, manufacturer } =
      await deployAndAssignRoles();

    expect(
      await pharmaSupplyChain.getTotalBatches()
    ).to.equal(0);

    await pharmaSupplyChain
      .connect(manufacturer)
      .registerMedicine(
        "Paracetamol",
        "PCM2026002",
        "ABC Pharma",
        1754524800,
        1817683200,
        5000
      );

    expect(
      await pharmaSupplyChain.getTotalBatches()
    ).to.equal(1);
  });


  it("Should reject medicine registration from an unregistered address", async function () {

    const { pharmaSupplyChain, consumer } =
      await deployAndAssignRoles();

    await expect(
      pharmaSupplyChain
        .connect(consumer)
        .registerMedicine(
          "FakeDrug",
          "FAKE001",
          "Nobody",
          1754524800,
          1817683200,
          100
        )
    ).to.be.revertedWith("Caller does not have the required role");
  });


  it("Should assign roles correctly via registerParticipant", async function () {

    const { pharmaSupplyChain, distributor } =
      await deployAndAssignRoles();

    const role = await pharmaSupplyChain.getRole(distributor.address);

    expect(role).to.equal(Role.Distributor);
  });


  it("Should transfer a batch through the full supply chain", async function () {

    const {
      pharmaSupplyChain,
      manufacturer,
      distributor,
      pharmacy,
      consumer,
    } = await deployAndAssignRoles();

    await pharmaSupplyChain
      .connect(manufacturer)
      .registerMedicine(
        "Amoxicillin",
        "AMX2026001",
        "MedLife Labs",
        1754524800,
        1817683200,
        7500
      );

    // Manufacturer -> Distributor
    await pharmaSupplyChain
      .connect(manufacturer)
      .transferBatch(1, distributor.address);

    let batch = await pharmaSupplyChain.getMedicine(1);
    expect(batch.currentOwner).to.equal(distributor.address);
    expect(batch.previousOwner).to.equal(manufacturer.address);
    expect(batch.status).to.equal(BatchStatus.InTransit);

    // Distributor -> Pharmacy
    await pharmaSupplyChain
      .connect(distributor)
      .transferBatch(1, pharmacy.address);

    batch = await pharmaSupplyChain.getMedicine(1);
    expect(batch.currentOwner).to.equal(pharmacy.address);
    expect(batch.status).to.equal(BatchStatus.InTransit);

    // Pharmacy -> Consumer
    await pharmaSupplyChain
      .connect(pharmacy)
      .transferBatch(1, consumer.address);

    batch = await pharmaSupplyChain.getMedicine(1);
    expect(batch.currentOwner).to.equal(consumer.address);
    expect(batch.status).to.equal(BatchStatus.Sold);

    const history = await pharmaSupplyChain.getTransferHistory(1);
    expect(history.length).to.equal(3);
  });


  it("Should reject an out-of-order transfer", async function () {

    const { pharmaSupplyChain, manufacturer, pharmacy } =
      await deployAndAssignRoles();

    await pharmaSupplyChain
      .connect(manufacturer)
      .registerMedicine(
        "Azithromycin",
        "AZT2026001",
        "HealthCare Ltd",
        1754524800,
        1817683200,
        5000
      );

    // Manufacturer trying to transfer directly to a Pharmacy should fail
    await expect(
      pharmaSupplyChain
        .connect(manufacturer)
        .transferBatch(1, pharmacy.address)
    ).to.be.revertedWith(
      "Manufacturer can only transfer to a registered Distributor"
    );
  });


  it("Should recall a batch and block further transfers", async function () {

    const { pharmaSupplyChain, admin, manufacturer, distributor } =
      await deployAndAssignRoles();

    await pharmaSupplyChain
      .connect(manufacturer)
      .registerMedicine(
        "Ibuprofen",
        "IBU2026001",
        "Global Pharma",
        1754524800,
        1817683200,
        8000
      );

    await pharmaSupplyChain.connect(admin).recallBatch(1);

    const batch = await pharmaSupplyChain.getMedicine(1);
    expect(batch.status).to.equal(BatchStatus.Recalled);

    await expect(
      pharmaSupplyChain
        .connect(manufacturer)
        .transferBatch(1, distributor.address)
    ).to.be.revertedWith("Cannot transfer a recalled batch");
  });

});