import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

import {
  LayoutDashboard,
  Package,
  PlusCircle,
  Search,
  ShieldCheck,
  Link,
  Bell,
  User,
  Activity,
  Truck,
  CheckCircle,
  AlertTriangle,
  UserPlus,
} from "lucide-react";

import "./index.css";

import PharmaSupplyChainABI from "./contracts/PharmaSupplyChainABI.json";
import {
  CONTRACT_ADDRESS,
  NETWORK_CHAIN_ID,
  NETWORK_NAME,
} from "./contracts/contractConfig.js";

// Must match the Solidity contract's Role enum order exactly:
// enum Role { None, Manufacturer, Distributor, Pharmacy, Regulator }
const ROLE_LABELS = ["None", "Manufacturer", "Distributor", "Pharmacy", "Regulator"];
const BATCH_STATUS_LABELS = ["Created", "In Transit", "Sold", "Recalled"];

const formatDate = (timestamp) =>
  timestamp ? new Date(Number(timestamp) * 1000).toLocaleDateString() : "—";

const shortAddress = (address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "—";

const titleCase = (value = "") => value.replace(/\b\w/g, (letter) => letter.toUpperCase());

const getStatusClass = (status = "") => {
  const key = status.trim().toLowerCase();
  if (key === "in transit") return "status-amber";
  if (key === "delivered" || key === "sold") return "status-blue";
  if (key === "recalled" || key === "expired") return "status-rose";
  return "status-emerald";
};

// Some browsers expose several wallet extensions through window.ethereum.
// Always prefer MetaMask instead of accidentally using a local Hardhat wallet.
const getMetaMaskProvider = () => {
  if (!window.ethereum) return null;
  return window.ethereum.providers?.find((provider) => provider.isMetaMask) ?? window.ethereum;
};

function App() {
  const [activeMenu, setActiveMenu] = useState("Dashboard");

  // Wallet / blockchain connection state
  const [walletAddress, setWalletAddress] = useState("");
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  // Role state
  const [userRole, setUserRole] = useState(null); // numeric role (0-4) or null if unknown
  const [roleLoading, setRoleLoading] = useState(false);

  // Admin detection (for Register User module)
  const [adminAddress, setAdminAddress] = useState("");

  // Register User / Participant form state
  const [newParticipantAddress, setNewParticipantAddress] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState("1"); // default: Manufacturer
  const [registerUserStatus, setRegisterUserStatus] = useState(""); // "", "confirming", "pending", "success", "error"
  const [registerUserMessage, setRegisterUserMessage] = useState("");
  const [registerUserResult, setRegisterUserResult] = useState(null);

  // Medicine registration and lookup state
  const [medicineForm, setMedicineForm] = useState({
    medicineName: "", batchNumber: "", manufacturerName: "", manufacturingDate: "", expiryDate: "", quantity: "",
  });
  const [medicineMessage, setMedicineMessage] = useState("");
  const [medicineError, setMedicineError] = useState(false);
  const [lookupBatchId, setLookupBatchId] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupHistory, setLookupHistory] = useState([]);
  const [lookupMessage, setLookupMessage] = useState("");
  const [verifyBatchId, setVerifyBatchId] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState("");
  const [transferBatchId, setTransferBatchId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferMessage, setTransferMessage] = useState("");
  const [recallBatchId, setRecallBatchId] = useState("");
  const [recallMessage, setRecallMessage] = useState("");

  // Simple tester-facing records. They stay in this browser so a tester can
  // use the app without creating a wallet or understanding blockchain roles.
  const [testUsers, setTestUsers] = useState(() => JSON.parse(localStorage.getItem("pharma-test-users") || "[]"));
  const [testMedicines, setTestMedicines] = useState(() => JSON.parse(localStorage.getItem("pharma-test-medicines") || "[]").map((medicine) => ({
    ...medicine,
    expiryDate: medicine.expiryDate || "2026-12-31",
    storageTemp: medicine.storageTemp || "2°C - 8°C",
  })));
  const [simpleUser, setSimpleUser] = useState({ name: "", email: "", organisation: "", role: "Customer" });
  const [simpleMedicine, setSimpleMedicine] = useState({ name: "", batchNumber: "", manufacturer: "", quantity: "", manufacturingDate: "", expiryDate: "", storageTemp: "2°C - 8°C" });
  const [simpleMessage, setSimpleMessage] = useState("");
  const [medicineSearch, setMedicineSearch] = useState("");

  const historicalBaseline = (() => {
    try { return JSON.parse(localStorage.getItem("pharma-metrics-baseline") || "null"); } catch { return null; }
  })();
  const metricCaption = (metric, count) => {
    const baseline = historicalBaseline?.[metric];
    if (count > 5 && Number.isFinite(baseline) && baseline >= 0) {
      const growth = baseline === 0 ? 100 : ((count - baseline) / baseline) * 100;
      return `↑ ${growth.toFixed(1)}% this month`;
    }
    return "Updated today";
  };

  const renderGrowthBadge = (metric, count, fallback) => {
    if (count <= 5) return null;
    const caption = metricCaption(metric, count);
    return (
      <span className="positive">{caption !== "Updated today" ? caption : fallback}</span>
    );
  };

  const saveTestUsers = (users) => { setTestUsers(users); localStorage.setItem("pharma-test-users", JSON.stringify(users)); };
  const saveTestMedicines = (medicines) => { setTestMedicines(medicines); localStorage.setItem("pharma-test-medicines", JSON.stringify(medicines)); };

  const handleSimpleUser = (e) => {
    e.preventDefault();
    if (!simpleUser.name || !simpleUser.email) return;
    saveTestUsers([{ ...simpleUser, id: crypto.randomUUID() }, ...testUsers]);
    setSimpleUser({ name: "", email: "", organisation: "", role: "Customer" });
  };

  const handleSimpleMedicine = (e) => {
    e.preventDefault();
    setSimpleMessage("");
    const { name, batchNumber, manufacturer, quantity, manufacturingDate, expiryDate } = simpleMedicine;
    if (!name || !batchNumber || !manufacturer || !quantity || !manufacturingDate || !expiryDate) { setSimpleMessage("Please complete every field."); return; }
    if (testMedicines.some((medicine) => medicine.batchNumber.toLowerCase() === batchNumber.toLowerCase())) { setSimpleMessage("This batch number already exists."); return; }
    if (expiryDate <= manufacturingDate) { setSimpleMessage("Expiry date must be after manufacturing date."); return; }
    saveTestMedicines([{ ...simpleMedicine, id: crypto.randomUUID(), status: "Registered" }, ...testMedicines]);
    setSimpleMedicine({ name: "", batchNumber: "", manufacturer: "", quantity: "", manufacturingDate: "", expiryDate: "", storageTemp: "2°C - 8°C" });
    setSimpleMessage("Medicine added successfully. It is now visible in Medicines and Dashboard.");
  };

  const deleteTestMedicine = (id) => {
    if (!window.confirm("Delete this medicine from the tester list?")) return;
    saveTestMedicines(testMedicines.filter((medicine) => medicine.id !== id));
    setLookupBatchId("");
    setVerifyBatchId("");
  };

  const friendlyError = (error) => {
    if (error?.code === "ACTION_REJECTED" || error?.code === 4001) return "You rejected the transaction in MetaMask.";
    return error?.reason || error?.shortMessage || error?.message || "Something went wrong. Please try again.";
  };

  const requireContract = () => {
    if (!contract || !walletAddress || !isCorrectNetwork) {
      throw new Error(`Connect MetaMask to ${NETWORK_NAME} before continuing.`);
    }
  };

  // The contract stores batches by numeric ID but publishes each human-readable
  // batch number in MedicineRegistered. Accept either value in the UI.
  const resolveBatchId = async (value) => {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized) && Number(normalized) > 0) return normalized;
    if (!normalized) throw new Error("Enter a batch number or Batch ID.");
    const events = await contract.queryFilter(contract.filters.MedicineRegistered());
    const match = events.find((event) =>
      event.args?.batchNumber?.toLowerCase() === normalized.toLowerCase()
    );
    if (!match) throw new Error("No medicine batch matches that batch number.");
    return match.args.batchId.toString();
  };

  const handleRegisterMedicine = async (e) => {
    e.preventDefault();
    setMedicineMessage("");
    try {
      requireContract();
      // Read the current role from Sepolia at submit time. This avoids blocking
      // a newly registered Manufacturer because React still displays an older role.
      const currentRole = Number(await contract.getRole(walletAddress));
      setUserRole(currentRole);
      if (currentRole !== 1) throw new Error("Only a registered Manufacturer can register medicine.");
      const { medicineName, batchNumber, manufacturerName, manufacturingDate, expiryDate, quantity } = medicineForm;
      if (!medicineName || !batchNumber || !manufacturerName || !manufacturingDate || !expiryDate || !quantity) throw new Error("Please complete every field.");
      const madeAt = Math.floor(new Date(`${manufacturingDate}T00:00:00`).getTime() / 1000);
      const expiresAt = Math.floor(new Date(`${expiryDate}T00:00:00`).getTime() / 1000);
      if (!Number.isFinite(madeAt) || !Number.isFinite(expiresAt) || expiresAt <= madeAt) throw new Error("Expiry date must be after the manufacturing date.");
      if (Number(quantity) <= 0) throw new Error("Quantity must be greater than zero.");
      setMedicineError(false);
      setMedicineMessage("Waiting for MetaMask confirmation...");
      const tx = await contract.registerMedicine(medicineName, batchNumber, manufacturerName, madeAt, expiresAt, quantity);
      setMedicineMessage("Transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      const log = receipt.logs.map((item) => { try { return contract.interface.parseLog(item); } catch { return null; } }).find((item) => item?.name === "MedicineRegistered");
      setMedicineMessage(`Medicine registered successfully. Batch ID: ${log ? log.args.batchId.toString() : "see transaction"}.`);
      setMedicineForm({ medicineName: "", batchNumber: "", manufacturerName: "", manufacturingDate: "", expiryDate: "", quantity: "" });
    } catch (error) {
      setMedicineError(true);
      setMedicineMessage(friendlyError(error));
    }
  };

  const handleTrack = async (e) => {
    e.preventDefault();
    setLookupResult(null); setLookupHistory([]); setLookupMessage("");
    try {
      requireContract();
      const batchId = await resolveBatchId(lookupBatchId);
      const [batch, history] = await Promise.all([contract.getMedicine(batchId), contract.getTransferHistory(batchId)]);
      setLookupResult(batch); setLookupHistory(history);
    } catch (error) { setLookupMessage(friendlyError(error)); }
  };

  const handleVerify = async (e) => {
    e.preventDefault(); setVerifyResult(null); setVerifyMessage("");
    try {
      requireContract();
      const batchId = await resolveBatchId(verifyBatchId);
      const result = await contract.verifyBatch(batchId);
      if (!result.exists) throw new Error("This medicine batch does not exist.");
      setVerifyResult(result);
    } catch (error) { setVerifyMessage(friendlyError(error)); }
  };

  const handleTransfer = async (e) => {
    e.preventDefault(); setTransferMessage("");
    try {
      requireContract();
      if (!/^\d+$/.test(transferBatchId) || Number(transferBatchId) < 1) throw new Error("Enter a valid Batch ID.");
      if (!ethers.isAddress(transferTo)) throw new Error("Enter a valid recipient wallet address.");
      setTransferMessage("Waiting for MetaMask confirmation...");
      const tx = await contract.transferBatch(transferBatchId, transferTo);
      await tx.wait();
      setTransferMessage("Batch transferred successfully."); setTransferBatchId(""); setTransferTo("");
    } catch (error) { setTransferMessage(friendlyError(error)); }
  };

  const handleRecall = async (e) => {
    e.preventDefault(); setRecallMessage("");
    try {
      requireContract();
      if (!isAdmin) throw new Error("Only the contract admin (regulator) can recall a batch.");
      if (!/^\d+$/.test(recallBatchId) || Number(recallBatchId) < 1) throw new Error("Enter a valid Batch ID.");
      setRecallMessage("Waiting for MetaMask confirmation...");
      const tx = await contract.recallBatch(recallBatchId);
      await tx.wait(); setRecallMessage("Batch recalled successfully."); setRecallBatchId("");
    } catch (error) { setRecallMessage(friendlyError(error)); }
  };

  // Fetch the connected account's role from the contract
  const fetchUserRole = useCallback(async (contractInstance, address) => {
    if (!contractInstance || !address) {
      setUserRole(null);
      return;
    }

    setRoleLoading(true);

    try {
      const roleValue = await contractInstance.getRole(address);
      setUserRole(Number(roleValue));
    } catch (error) {
      console.error("Failed to fetch user role:", error);
      setUserRole(null);
    } finally {
      setRoleLoading(false);
    }
  }, []);

  // Build a read/write contract instance and update connection state
  const setupConnection = useCallback(async (browserProvider, connectedAddress) => {
    try {
      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);
      setChainId(currentChainId);

      const onCorrectNetwork = currentChainId === NETWORK_CHAIN_ID;
      setIsCorrectNetwork(onCorrectNetwork);

      if (!onCorrectNetwork) {
        setConnectionError(
          `Wrong network detected (chain ID ${currentChainId}). Please switch MetaMask to ${NETWORK_NAME} (chain ID ${NETWORK_CHAIN_ID}).`
        );
        setSigner(null);
        setContract(null);
        setUserRole(null);
        return;
      }

      setConnectionError("");

      const currentSigner = await browserProvider.getSigner();
      setSigner(currentSigner);

      const contractInstance = new ethers.Contract(
        CONTRACT_ADDRESS,
        PharmaSupplyChainABI,
        currentSigner
      );
      setContract(contractInstance);

      try {
        const adminAddr = await contractInstance.admin();
        setAdminAddress(adminAddr);
      } catch (adminError) {
        console.error("Failed to fetch admin address:", adminError);
      }

      const addressToCheck = connectedAddress || (await currentSigner.getAddress());
      await fetchUserRole(contractInstance, addressToCheck);
    } catch (error) {
      console.error("Failed to set up blockchain connection:", error);
      setConnectionError("Failed to connect to the blockchain. See console for details.");
    }
  }, [fetchUserRole]);

  // Connect MetaMask wallet
  const connectWallet = async () => {
    const ethereumProvider = getMetaMaskProvider();
    if (!ethereumProvider) {
      alert("MetaMask is not installed. Please install MetaMask first.");
      return;
    }

    try {
      const accounts = await ethereumProvider.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);

        const browserProvider = new ethers.BrowserProvider(ethereumProvider);
        await setupConnection(browserProvider, accounts[0]);
      }
    } catch (error) {
      console.error("Wallet connection failed:", error);
      alert("Wallet connection was cancelled.");
    }
  };

  const switchToSepolia = async () => {
    const ethereumProvider = getMetaMaskProvider();
    if (!ethereumProvider) {
      setConnectionError("MetaMask is not available in this browser.");
      return;
    }
    try {
      await ethereumProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${NETWORK_CHAIN_ID.toString(16)}` }],
      });
      const browserProvider = new ethers.BrowserProvider(ethereumProvider);
      await setupConnection(browserProvider);
    } catch (error) {
      console.error("Could not switch network:", error);
      setConnectionError(`Could not switch to ${NETWORK_NAME}. Open MetaMask, select Sepolia, then reconnect.`);
    }
  };

  // React to account or network changes without requiring a manual reconnect
  useEffect(() => {
    const ethereumProvider = getMetaMaskProvider();
    if (!ethereumProvider) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        // User disconnected all accounts in MetaMask
        setWalletAddress("");
        setSigner(null);
        setContract(null);
        setUserRole(null);
      } else {
        setWalletAddress(accounts[0]);
        const browserProvider = new ethers.BrowserProvider(ethereumProvider);
        setupConnection(browserProvider, accounts[0]);
      }
    };

    const handleChainChanged = () => {
      // Simplest safe approach: reload connection state on network switch
      const browserProvider = new ethers.BrowserProvider(ethereumProvider);
      setupConnection(browserProvider);
    };

    ethereumProvider.on("accountsChanged", handleAccountsChanged);
    ethereumProvider.on("chainChanged", handleChainChanged);

    return () => {
      ethereumProvider.removeListener("accountsChanged", handleAccountsChanged);
      ethereumProvider.removeListener("chainChanged", handleChainChanged);
    };
  }, [setupConnection]);

  // Register a new participant (admin only)
  const handleRegisterParticipant = async (e) => {
    e.preventDefault();
    setRegisterUserResult(null);

    if (!walletAddress) {
      setRegisterUserStatus("error");
      setRegisterUserMessage("Please connect MetaMask first.");
      return;
    }

    if (!isCorrectNetwork) {
      setRegisterUserStatus("error");
      setRegisterUserMessage("Please switch MetaMask to the correct network first.");
      return;
    }

    if (!isAdmin) {
      setRegisterUserStatus("error");
      setRegisterUserMessage("Only the contract admin can register participants.");
      return;
    }

    if (!ethers.isAddress(newParticipantAddress)) {
      setRegisterUserStatus("error");
      setRegisterUserMessage("Please enter a valid Ethereum address.");
      return;
    }

    const roleNumber = Number(newParticipantRole);
    if (!roleNumber || roleNumber < 1 || roleNumber > 4) {
      setRegisterUserStatus("error");
      setRegisterUserMessage("Please select a valid role.");
      return;
    }

    try {
      setRegisterUserStatus("confirming");
      setRegisterUserMessage("Waiting for MetaMask confirmation...");

      const tx = await contract.registerParticipant(newParticipantAddress, roleNumber);

      setRegisterUserStatus("pending");
      setRegisterUserMessage("Transaction submitted. Waiting for confirmation...");

      const receipt = await tx.wait();

      let registeredAddress = newParticipantAddress;
      let registeredRole = roleNumber;

      try {
        const parsedLog = receipt.logs
          .map((log) => {
            try {
              return contract.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed && parsed.name === "ParticipantRegistered");

        if (parsedLog) {
          registeredAddress = parsedLog.args.participant;
          registeredRole = Number(parsedLog.args.role);
        }
      } catch (parseError) {
        console.error("Could not parse ParticipantRegistered event:", parseError);
      }

      setRegisterUserStatus("success");
      setRegisterUserMessage("Participant registered successfully.");
      setRegisterUserResult({
        address: registeredAddress,
        role: ROLE_LABELS[registeredRole],
      });

      // A role is stored per wallet. Refresh immediately when the admin
      // registers the currently connected account, so the sidebar stays true.
      if (registeredAddress.toLowerCase() === walletAddress.toLowerCase()) {
        await fetchUserRole(contract, walletAddress);
      }

      setNewParticipantAddress("");
      setNewParticipantRole("1");
    } catch (error) {
      console.error("Register participant failed:", error);

      let friendlyMessage = "Transaction failed. Please try again.";

      if (error.code === "ACTION_REJECTED" || error.code === 4001) {
        friendlyMessage = "You rejected the transaction in MetaMask.";
      } else if (error.reason) {
        friendlyMessage = error.reason;
      } else if (error.message && error.message.includes("insufficient funds")) {
        friendlyMessage = "Insufficient funds for this transaction.";
      } else if (error.message) {
        friendlyMessage = error.message;
      }

      setRegisterUserStatus("error");
      setRegisterUserMessage(friendlyMessage);
    }
  };

  // Sidebar menu
  const menuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      name: "Medicines",
      icon: <Package size={20} />,
    },
    {
      name: "Register Medicine",
      icon: <PlusCircle size={20} />,
    },
    {
      name: "Register User",
      icon: <UserPlus size={20} />,
    },
    {
      name: "Track Medicine",
      icon: <Search size={20} />,
    },
    {
      name: "Verify Medicine",
      icon: <ShieldCheck size={20} />,
    },
    {
      name: "Blockchain",
      icon: <Link size={20} />,
    },
  ];

  const roleLabel = userRole !== null ? ROLE_LABELS[userRole] : null;

  const isAdmin =
    walletAddress &&
    adminAddress &&
    walletAddress.toLowerCase() === adminAddress.toLowerCase();

  return (
    <div className="app">

      {/* ================= SIDEBAR ================= */}

      <aside className="sidebar">

        {/* Logo */}
        <div className="logo">
          <div className="logo-icon">💊</div>

          <div>
            <h2>PharmaChain</h2>
            <span>Supply Management</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="navigation">

          <p className="menu-title">MAIN MENU</p>

          {menuItems.slice(0, 5).map((item) => (
            <button
              key={item.name}
              className={`nav-item ${
                activeMenu === item.name ? "active" : ""
              }`}
              onClick={() => setActiveMenu(item.name)}
            >
              {item.icon}
              {item.name}
            </button>
          ))}

          <p className="menu-title">BLOCKCHAIN</p>

          {menuItems.slice(5).map((item) => (
            <button
              key={item.name}
              className={`nav-item ${
                activeMenu === item.name ? "active" : ""
              }`}
              onClick={() => setActiveMenu(item.name)}
            >
              {item.icon}
              {item.name}
            </button>
          ))}

        </nav>

        {/* Network Status */}
        <div className="sidebar-bottom">

          {walletAddress && isCorrectNetwork && (
            <div
              className="network-status"
              style={{ marginBottom: "10px" }}
            >
              <span
                className="status-dot"
                style={{
                  background: userRole && userRole > 0 ? "#22c55e" : "#f59e0b",
                }}
              ></span>

              <div>
                <strong>Account Role</strong>
                <small>
                  {roleLoading
                    ? "Checking..."
                    : roleLabel && userRole > 0
                    ? roleLabel
                    : "Not Registered"}
                </small>
              </div>
            </div>
          )}

          <div className="network-status">

            <span
              className="status-dot"
              style={{
                background: isCorrectNetwork ? "#22c55e" : "#ef4444",
              }}
            ></span>

            <div>
              <strong>Ethereum Network</strong>
              <small>
                {isCorrectNetwork
                  ? `${NETWORK_NAME} Connected`
                  : walletAddress
                  ? "Wrong Network"
                  : "Not Connected"}
              </small>
            </div>

          </div>

        </div>

      </aside>


      {/* ================= MAIN CONTENT ================= */}

      <main className="main">

        {/* Header */}

        <header className="header">

          <div>
            <h1>{activeMenu}</h1>

            <p>
              Pharmaceutical Supply Chain Management
            </p>
          </div>

          <div className="header-actions">

            {/* Notification */}

            <button className="icon-button">
              <Bell size={20} />
            </button>


            {/* Connect Wallet */}

            <button
              className="connect-button"
              onClick={connectWallet}
            >
              <span className="wallet-icon">🦊</span>

              {walletAddress
                ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect Wallet"}
            </button>


            {/* Profile */}

            <div className="profile">

              <div className="profile-icon">
                <User size={18} />
              </div>

            </div>

          </div>

        </header>

        {/* Connection error banner */}
        {connectionError && (
          <div
            style={{
              margin: "20px 35px 0",
              background: "#fef2f2",
              color: "#b91c1c",
              padding: "12px 16px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <AlertTriangle size={16} />
            {connectionError}
            {walletAddress && !isCorrectNetwork && (
              <button
                type="button"
                onClick={switchToSepolia}
                style={{ marginLeft: "auto", border: 0, borderRadius: "6px", padding: "7px 10px", cursor: "pointer", fontWeight: 700 }}
              >
                Switch to {NETWORK_NAME}
              </button>
            )}
          </div>
        )}


        {activeMenu === "Dashboard" && (
          <>
        {/* ================= WELCOME ================= */}

        <section className="welcome">

          <div>

            <h2>
              Welcome to PharmaChain 👋
            </h2>

            <p>
              Monitor and manage your pharmaceutical supply
              chain securely using blockchain technology.
            </p>

          </div>

          <div className="blockchain-badge">

            <ShieldCheck size={18} />

            Blockchain Secured

          </div>

        </section>


        {/* ================= STATISTICS ================= */}

        <section className="stats">

          {/* Total Medicines */}

          <div className="stat-card">

            <div className="stat-icon stat-icon-blue">
              <Package size={24} />
            </div>

            <div>

              <p>Total Medicines</p>

              <h2>{testMedicines.length}</h2>

              {renderGrowthBadge("totalMedicines", testMedicines.length, "↑ 12.5% this month")}

            </div>

          </div>


          {/* Active Batches */}

          <div className="stat-card">

            <div className="stat-icon stat-icon-purple">
              <Activity size={24} />
            </div>

            <div>

              <p>Active Batches</p>

              <h2>{testMedicines.length}</h2>

              {renderGrowthBadge("activeBatches", testMedicines.length, "↑ 8.2% this month")}

            </div>

          </div>


          {/* In Transit */}

          <div className="stat-card">

            <div className="stat-icon stat-icon-amber">
              <Truck size={24} />
            </div>

            <div>

              <p>In Transit</p>

              <h2>0</h2>

              {renderGrowthBadge("inTransit", 0, "↑ 4.1% this month")}

            </div>

          </div>


          {/* Verified */}

          <div className="stat-card">

            <div className="stat-icon stat-icon-emerald">
              <ShieldCheck size={24} />
            </div>

            <div>

              <p>Verified</p>

              <h2>{testMedicines.length ? "100%" : "0%"}</h2>

              {renderGrowthBadge("verified", testMedicines.length, "↑ 2.4% this month")}

            </div>

          </div>

        </section>


        {/* ================= DASHBOARD GRID ================= */}

        <section className="dashboard-grid">


          {/* ================= RECENT BATCHES ================= */}

          <div className="card large-card">

            <div className="card-header">

              <div>

                <h3>
                  Recent Medicine Batches
                </h3>

                <p>
                  Latest pharmaceutical supply chain activity
                </p>

              </div>

              <button className="view-button" onClick={() => setActiveMenu("Medicines")}>
                View All
              </button>

            </div>


            <div className="table-container">

              <table className="dashboard-table">

                <thead>

                  <tr>

                    <th>Medicine</th>

                    <th>Batch Number</th>

                    <th>Manufacturer</th>

                    <th>Quantity</th>

                    <th>Expiry Date</th>

                    <th>Storage Temp</th>

                    <th>Status</th>

                    <th>Action</th>

                  </tr>

                </thead>


                <tbody>
                  {testMedicines.length > 0 ? testMedicines.slice(0, 5).map((medicine) => (
                    <tr key={medicine.id}>
                      <td><strong className="capitalize-cell">{titleCase(medicine.name)}</strong></td>
                      <td>{medicine.batchNumber}</td>
                      <td className="capitalize-cell">{titleCase(medicine.manufacturer)}</td>
                      <td>{medicine.quantity}</td>
                      <td>{medicine.expiryDate || "2026-12-31"}</td>
                      <td>
                        <span className="storage-temp-pill">
                          {medicine.storageTemp || "2°C - 8°C"}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${getStatusClass(medicine.status)}`}>
                          {medicine.status}
                        </span>
                      </td>
                      <td><button className="view-button" onClick={() => deleteTestMedicine(medicine.id)}>Delete</button></td>
                    </tr>
                  )) : <tr><td colSpan="8">No medicines registered yet.</td></tr>}
                  {false && <>


                  {/* Paracetamol */}

                  <tr>

                    <td>

                      <strong>
                        Paracetamol
                      </strong>

                      <small>
                        500mg Tablets
                      </small>

                    </td>

                    <td>
                      PCM2026001
                    </td>

                    <td>
                      ABC Pharma
                    </td>

                    <td>
                      10,000
                    </td>

                    <td>

                      <span className="status verified">

                        <CheckCircle size={14} />

                        Verified

                      </span>

                    </td>

                  </tr>


                  {/* Amoxicillin */}

                  <tr>

                    <td>

                      <strong>
                        Amoxicillin
                      </strong>

                      <small>
                        250mg Capsules
                      </small>

                    </td>

                    <td>
                      AMX2026002
                    </td>

                    <td>
                      MedLife Labs
                    </td>

                    <td>
                      7,500
                    </td>

                    <td>

                      <span className="status transit">

                        <Truck size={14} />

                        In Transit

                      </span>

                    </td>

                  </tr>


                  {/* Azithromycin */}

                  <tr>

                    <td>

                      <strong>
                        Azithromycin
                      </strong>

                      <small>
                        500mg Tablets
                      </small>

                    </td>

                    <td>
                      AZT2026003
                    </td>

                    <td>
                      HealthCare Ltd
                    </td>

                    <td>
                      5,000
                    </td>

                    <td>

                      <span className="status verified">

                        <CheckCircle size={14} />

                        Verified

                      </span>

                    </td>

                  </tr>


                  {/* Ibuprofen */}

                  <tr>

                    <td>

                      <strong>
                        Ibuprofen
                      </strong>

                      <small>
                        400mg Tablets
                      </small>

                    </td>

                    <td>
                      IBU2026004
                    </td>

                    <td>
                      Global Pharma
                    </td>

                    <td>
                      8,000
                    </td>

                    <td>

                      <span className="status pending">

                        <Activity size={14} />

                        Processing

                      </span>

                    </td>

                  </tr>
                  </>}

                </tbody>

              </table>

            </div>

          </div>


          {/* ================= BLOCKCHAIN STATUS ================= */}

          <div className="card blockchain-card">

            <div className="card-header">

              <div>

                <h3>
                  Blockchain Status
                </h3>

                <p>
                  Network information
                </p>

              </div>

              <ShieldCheck
                className="shield"
                size={25}
              />

            </div>


            <div className="blockchain-info">


              <div className="chain-row">

                <span>
                  Network
                </span>

                <strong>
                  Ethereum
                </strong>

              </div>


              <div className="chain-row">

                <span>
                  Network Type
                </span>

                <strong>
                  {NETWORK_NAME}
                </strong>

              </div>


              <div className="chain-row">

                <span>
                  Chain ID
                </span>

                <strong>
                  {chainId ?? NETWORK_CHAIN_ID}
                </strong>

              </div>


              <div className="chain-row">

                <span>
                  Smart Contract
                </span>

                <strong className="contract-address">
                  {`${CONTRACT_ADDRESS.slice(0, 6)}...${CONTRACT_ADDRESS.slice(-4)}`}
                </strong>

              </div>

              {walletAddress && isCorrectNetwork && (
                <div className="chain-row">
                  <span>Your Role</span>
                  <strong>
                    {roleLoading
                      ? "Checking..."
                      : roleLabel && userRole > 0
                      ? roleLabel
                      : "Not Registered"}
                  </strong>
                </div>
              )}


            </div>


            {/* Connection */}

            <div
              className="connection"
              style={
                !isCorrectNetwork
                  ? { background: "#fef2f2", color: "#b91c1c" }
                  : undefined
              }
            >

              <span
                className="status-dot"
                style={{
                  background: isCorrectNetwork ? "#22c55e" : "#ef4444",
                }}
              ></span>

              {isCorrectNetwork
                ? "Blockchain Connected"
                : walletAddress
                ? "Wrong Network"
                : "Wallet Not Connected"}

            </div>

          </div>

        </section>


          </>
        )}

        {/* ================= REGISTER USER ================= */}

        {activeMenu === "Register User" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Register User</h3><p>Add a tester or supply-chain participant. No wallet details are needed.</p></div></div>
            <form onSubmit={handleSimpleUser} className="medicine-form"><label>Full name<input value={simpleUser.name} placeholder="Name" onChange={(e) => setSimpleUser({ ...simpleUser, name: e.target.value })} required /></label><label>Email address<input type="email" value={simpleUser.email} placeholder="name@company.com" onChange={(e) => setSimpleUser({ ...simpleUser, email: e.target.value })} required /></label><label>Organisation<input value={simpleUser.organisation} placeholder="Organisation name" onChange={(e) => setSimpleUser({ ...simpleUser, organisation: e.target.value })} /></label><label>Role<select value={simpleUser.role} onChange={(e) => setSimpleUser({ ...simpleUser, role: e.target.value })}><option>Customer</option><option>Manufacturer</option><option>Distributor</option><option>Pharmacy</option><option>Regulator</option></select></label><button className="connect-button" type="submit">Register user</button></form>
            <h3 style={{ marginTop: "28px" }}>Registered Users</h3>{testUsers.length === 0 ? <p>No users registered yet.</p> : <div className="result-card">{testUsers.map((user) => <p key={user.id}><strong>{user.name}</strong> · {user.role} · {user.email}</p>)}</div>}
          </div></section>
        )}

        {false && activeMenu === "Register User" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}>
            <div className="card large-card">
              <div className="card-header">
                <div>
                  <h3>Register New Participant</h3>
                  <p>Assign a role to a wallet address on the blockchain</p>
                </div>
              </div>

              {!walletAddress && (
                <div
                  style={{
                    margin: "0 0 20px",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle size={16} />
                  Please connect MetaMask first.
                </div>
              )}

              {walletAddress && isCorrectNetwork && !isAdmin && (
                <div
                  style={{
                    margin: "0 0 20px",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle size={16} />
                  Only the contract admin can register participants.
                </div>
              )}

              {walletAddress && isCorrectNetwork && isAdmin && (
                <form onSubmit={handleRegisterParticipant}>
                  <div style={{ marginBottom: "16px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#374151",
                      }}
                    >
                      Participant wallet address
                    </label>
                    <input
                      type="text"
                      value={newParticipantAddress}
                      onChange={(e) => setNewParticipantAddress(e.target.value)}
                      placeholder="0x..."
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                      }}
                    />
                    <small style={{ display: "block", marginTop: "7px", color: "#6b7280" }}>
                      Ask the participant to open MetaMask and click the copy icon beside their account. Their full address begins with 0x. It is their blockchain account number.
                    </small>
                  </div>

                  <div style={{ marginBottom: "20px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#374151",
                      }}
                    >
                      Role
                    </label>
                    <select
                      value={newParticipantRole}
                      onChange={(e) => setNewParticipantRole(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                      }}
                    >
                      <option value="1">Manufacturer</option>
                      <option value="2">Distributor</option>
                      <option value="3">Pharmacy</option>
                      <option value="4">Regulator</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="connect-button"
                    disabled={
                      registerUserStatus === "confirming" ||
                      registerUserStatus === "pending"
                    }
                  >
                    {registerUserStatus === "confirming"
                      ? "Waiting for MetaMask..."
                      : registerUserStatus === "pending"
                      ? "Processing..."
                      : "Register Participant"}
                  </button>
                </form>
              )}

              {registerUserStatus === "error" && registerUserMessage && (
                <div
                  style={{
                    marginTop: "16px",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {registerUserMessage}
                </div>
              )}

              {registerUserStatus === "success" && registerUserResult && (
                <div
                  style={{
                    marginTop: "16px",
                    background: "#f0fdf4",
                    color: "#15803d",
                    padding: "16px",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                >
                  <strong style={{ display: "block", marginBottom: "8px" }}>
                    Participant Registered Successfully
                  </strong>
                  <div>Address: {registerUserResult.address}</div>
                  <div>Role: {registerUserResult.role}</div>
                </div>
              )}
            </div>
          </section>
        )}


        {activeMenu === "Register Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Register Medicine</h3><p>Add a batch directly. It will appear immediately in Medicines.</p></div></div>
            <form onSubmit={handleSimpleMedicine} className="medicine-form"><label>Medicine name<input value={simpleMedicine.name} placeholder="Paracetamol" onChange={(e) => setSimpleMedicine({ ...simpleMedicine, name: e.target.value })} required /></label><label>Batch number<input value={simpleMedicine.batchNumber} placeholder="PCM2026001" onChange={(e) => setSimpleMedicine({ ...simpleMedicine, batchNumber: e.target.value })} required /></label><label>Manufacturer<input value={simpleMedicine.manufacturer} placeholder="ABC Pharma" onChange={(e) => setSimpleMedicine({ ...simpleMedicine, manufacturer: e.target.value })} required /></label><label>Quantity<input type="number" min="1" value={simpleMedicine.quantity} placeholder="10000" onChange={(e) => setSimpleMedicine({ ...simpleMedicine, quantity: e.target.value })} required /></label><label>Manufacturing date<input type="date" value={simpleMedicine.manufacturingDate} onChange={(e) => setSimpleMedicine({ ...simpleMedicine, manufacturingDate: e.target.value })} required /></label><label>Expiry date<input type="date" value={simpleMedicine.expiryDate} onChange={(e) => setSimpleMedicine({ ...simpleMedicine, expiryDate: e.target.value })} required /></label><button className="connect-button" type="submit">Register medicine</button></form>{simpleMessage && <p style={{ fontWeight: 600, color: simpleMessage.includes("success") ? "#15803d" : "#b91c1c" }}>{simpleMessage}</p>}
          </div></section>
        )}

        {false && activeMenu === "Register Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Register Medicine Batch</h3><p>Only a wallet registered as Manufacturer can add a batch.</p></div></div>
            <form onSubmit={handleRegisterMedicine} className="medicine-form">
              {[['medicineName', 'Medicine name', 'Paracetamol 500mg'], ['batchNumber', 'Batch number', 'PCM2026001'], ['manufacturerName', 'Manufacturer name', 'ABC Pharma'], ['quantity', 'Quantity', '10000']].map(([field, label, placeholder]) => <label key={field}>{label}<input type={field === 'quantity' ? 'number' : 'text'} min={field === 'quantity' ? '1' : undefined} value={medicineForm[field]} placeholder={placeholder} onChange={(e) => setMedicineForm({ ...medicineForm, [field]: e.target.value })} /></label>)}
              <label>Manufacturing date<input type="date" value={medicineForm.manufacturingDate} onChange={(e) => setMedicineForm({ ...medicineForm, manufacturingDate: e.target.value })} /></label>
              <label>Expiry date<input type="date" value={medicineForm.expiryDate} onChange={(e) => setMedicineForm({ ...medicineForm, expiryDate: e.target.value })} /></label>
              <button className="connect-button" type="submit">Register Medicine</button>
            </form>
            {medicineMessage && <p style={{ color: medicineError ? '#b91c1c' : '#15803d', fontWeight: 600 }}>{medicineMessage}</p>}
          </div></section>
        )}

        {activeMenu === "Track Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Track Medicine</h3><p>Enter a batch number to view its supply-chain details.</p></div></div>
            <div className="inline-form"><input type="text" value={lookupBatchId} placeholder="e.g. PCM2026001" onChange={(e) => setLookupBatchId(e.target.value)} /><button className="connect-button" type="button">Track</button></div>
            {lookupBatchId && (() => { const medicine = testMedicines.find((item) => item.batchNumber.toLowerCase() === lookupBatchId.toLowerCase()); return medicine ? <div className="result-card"><h3>{medicine.name}</h3><p>Batch number: {medicine.batchNumber}</p><p>Manufacturer: {medicine.manufacturer}</p><p>Quantity: {medicine.quantity}</p><p>Manufactured: {medicine.manufacturingDate} · Expires: {medicine.expiryDate}</p><p>Status: {medicine.status}</p></div> : <p style={{ marginTop: "18px" }}>Enter a batch number from the Medicines page.</p>; })()}
          </div></section>
        )}

        {false && activeMenu === "Track Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Track Medicine</h3><p>Enter the batch number (for example, PCM2026001) or the internal Batch ID.</p></div></div>
            <form onSubmit={handleTrack} className="inline-form"><input type="text" value={lookupBatchId} placeholder="e.g. PCM2026001" onChange={(e) => setLookupBatchId(e.target.value)} /><button className="connect-button" type="submit">Track</button></form>
            {lookupMessage && <p style={{ color: '#b91c1c', fontWeight: 600 }}>{lookupMessage}</p>}
            {lookupResult && <div className="result-card"><h3>{lookupResult.medicineName} — {lookupResult.batchNumber}</h3><p>Manufacturer: {lookupResult.manufacturerName}</p><p>Quantity: {lookupResult.quantity.toString()} · Status: {BATCH_STATUS_LABELS[Number(lookupResult.status)]}</p><p>Manufactured: {formatDate(lookupResult.manufacturingDate)} · Expires: {formatDate(lookupResult.expiryDate)}</p><p>Current owner: {shortAddress(lookupResult.currentOwner)}</p><h4>Transfer history</h4>{lookupHistory.length ? lookupHistory.map((item, index) => <p key={index}>{shortAddress(item.from)} → {shortAddress(item.to)} on {formatDate(item.timestamp)}</p>) : <p>No transfers yet; this batch remains with its manufacturer.</p>}</div>}
          </div></section>
        )}

        {activeMenu === "Verify Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Verify Medicine</h3><p>Enter a batch number to check whether this medicine is registered and valid.</p></div></div>
            <div className="inline-form"><input type="text" value={verifyBatchId} placeholder="e.g. PCM2026001" onChange={(e) => setVerifyBatchId(e.target.value)} /><button className="connect-button" type="button">Verify</button></div>
            {verifyBatchId && (() => { const medicine = testMedicines.find((item) => item.batchNumber.toLowerCase() === verifyBatchId.toLowerCase()); const expired = medicine && new Date(`${medicine.expiryDate}T23:59:59`) < new Date(); return medicine ? <div className="result-card"><h3 style={{ color: expired ? "#b91c1c" : "#15803d" }}>{expired ? "Medicine is expired" : "Medicine is verified"}</h3><p>{medicine.name} · Batch {medicine.batchNumber}</p><p>Manufacturer: {medicine.manufacturer}</p><p>Expiry date: {medicine.expiryDate}</p><p>Status: {expired ? "Expired" : "Valid"}</p></div> : <p style={{ marginTop: "18px", color: "#b91c1c" }}>No medicine was found with this batch number.</p>; })()}
          </div></section>
        )}

        {false && activeMenu === "Verify Medicine" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Verify Medicine</h3><p>Verify authenticity and expiry status directly on Sepolia.</p></div></div>
            <form onSubmit={handleVerify} className="inline-form"><input type="text" value={verifyBatchId} placeholder="Batch number or ID" onChange={(e) => setVerifyBatchId(e.target.value)} /><button className="connect-button" type="submit">Verify</button></form>
            {verifyMessage && <p style={{ color: '#b91c1c', fontWeight: 600 }}>{verifyMessage}</p>}
            {verifyResult && <div className="result-card"><h3 style={{ color: verifyResult.authentic ? '#15803d' : '#b91c1c' }}>{verifyResult.authentic ? 'Authentic medicine batch' : 'Not authentic'}</h3><p>{verifyResult.medicineName} — {verifyResult.batchNumber}</p><p>Manufacturer: {verifyResult.manufacturerName}</p><p>Status: {BATCH_STATUS_LABELS[Number(verifyResult.status)]} · {verifyResult.expired ? 'Expired' : 'Not expired'}</p><p>Current owner: {shortAddress(verifyResult.currentOwner)}</p></div>}
          </div></section>
        )}

        {activeMenu === "Medicines" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Medicine Batches</h3><p>View and manage all registered medicine batches.</p></div><button className="connect-button" onClick={() => setActiveMenu("Register Medicine")}>+ Register medicine</button></div>
            <input type="text" value={medicineSearch} placeholder="Search by medicine, batch, or manufacturer" style={{ width: "100%", padding: "12px", marginBottom: "18px" }} onChange={(e) => setMedicineSearch(e.target.value)} />
            <div className="table-container"><table><thead><tr><th>Medicine</th><th>Batch Number</th><th>Manufacturer</th><th>Quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>{testMedicines.filter((medicine) => `${medicine.name} ${medicine.batchNumber} ${medicine.manufacturer}`.toLowerCase().includes(medicineSearch.toLowerCase())).map((medicine) => <tr key={medicine.id}><td><strong>{medicine.name}</strong></td><td>{medicine.batchNumber}</td><td>{medicine.manufacturer}</td><td>{medicine.quantity}</td><td><span className="status verified">Registered</span></td><td><button className="view-button" onClick={() => { setLookupBatchId(medicine.batchNumber); setActiveMenu("Track Medicine"); }}>Track</button></td></tr>)}{testMedicines.length === 0 && <tr><td colSpan="6">No medicines yet. Click “Register medicine” to add the first one.</td></tr>}</tbody></table></div>
          </div></section>
        )}

        {false && activeMenu === "Medicines" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Transfer Medicine Batch</h3><p>The current owner can transfer a batch to the next registered participant.</p></div></div>
            <form onSubmit={handleTransfer} className="medicine-form"><label>Batch ID<input type="number" min="1" value={transferBatchId} onChange={(e) => setTransferBatchId(e.target.value)} /></label><label>Recipient wallet address<input value={transferTo} placeholder="0x..." onChange={(e) => setTransferTo(e.target.value)} /></label><button className="connect-button" type="submit">Transfer Batch</button></form>
            {transferMessage && <p style={{ fontWeight: 600 }}>{transferMessage}</p>}
          </div></section>
        )}

        {activeMenu === "Blockchain" && (
          <section className="dashboard-grid" style={{ marginTop: "24px" }}><div className="card large-card"><div className="card-header"><div><h3>Blockchain Controls</h3><p>Contract: {shortAddress(CONTRACT_ADDRESS)} on {NETWORK_NAME}.</p></div></div>
            <form onSubmit={handleRecall} className="inline-form"><input type="number" min="1" value={recallBatchId} placeholder="Batch ID to recall" onChange={(e) => setRecallBatchId(e.target.value)} /><button className="connect-button" type="submit">Recall Batch</button></form>
            <p>Only the contract admin (regulator) can recall a medicine batch.</p>{recallMessage && <p style={{ fontWeight: 600 }}>{recallMessage}</p>}
          </div></section>
        )}

        {/* ================= FOOTER ================= */}

        <footer>

          <span>
            © 2026 PharmaChain
          </span>

          <span>
            Powered by Ethereum Blockchain
          </span>

        </footer>

      </main>

    </div>
  );
}

export default App;
