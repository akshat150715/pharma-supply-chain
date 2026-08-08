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
import { CONTRACT_ADDRESS, NETWORK_CHAIN_ID } from "./contracts/contractConfig.js";

// Must match the Solidity contract's Role enum order exactly:
// enum Role { None, Manufacturer, Distributor, Pharmacy, Regulator }
const ROLE_LABELS = ["None", "Manufacturer", "Distributor", "Pharmacy", "Regulator"];

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
          `Wrong network detected (chain ID ${currentChainId}). Please switch MetaMask to the local Hardhat network (chain ID ${NETWORK_CHAIN_ID}).`
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
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install MetaMask first.");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);

        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        await setupConnection(browserProvider, accounts[0]);
      }
    } catch (error) {
      console.error("Wallet connection failed:", error);
      alert("Wallet connection was cancelled.");
    }
  };

  // React to account or network changes without requiring a manual reconnect
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        // User disconnected all accounts in MetaMask
        setWalletAddress("");
        setSigner(null);
        setContract(null);
        setUserRole(null);
      } else {
        setWalletAddress(accounts[0]);
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        setupConnection(browserProvider, accounts[0]);
      }
    };

    const handleChainChanged = () => {
      // Simplest safe approach: reload connection state on network switch
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      setupConnection(browserProvider);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
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
                  ? "Local Network Connected"
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
          </div>
        )}


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

            <div className="stat-icon blue">
              <Package size={24} />
            </div>

            <div>

              <p>Total Medicines</p>

              <h2>1,248</h2>

              <span className="positive">
                ↑ 12.5% this month
              </span>

            </div>

          </div>


          {/* Active Batches */}

          <div className="stat-card">

            <div className="stat-icon purple">
              <Activity size={24} />
            </div>

            <div>

              <p>Active Batches</p>

              <h2>342</h2>

              <span className="positive">
                ↑ 8.2% this month
              </span>

            </div>

          </div>


          {/* In Transit */}

          <div className="stat-card">

            <div className="stat-icon green">
              <Truck size={24} />
            </div>

            <div>

              <p>In Transit</p>

              <h2>86</h2>

              <span className="positive">
                ↑ 4.1% this month
              </span>

            </div>

          </div>


          {/* Verified */}

          <div className="stat-card">

            <div className="stat-icon orange">
              <ShieldCheck size={24} />
            </div>

            <div>

              <p>Verified</p>

              <h2>98.7%</h2>

              <span className="positive">
                ↑ 2.4% this month
              </span>

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

              <button className="view-button">
                View All
              </button>

            </div>


            <div className="table-container">

              <table>

                <thead>

                  <tr>

                    <th>Medicine</th>

                    <th>Batch Number</th>

                    <th>Manufacturer</th>

                    <th>Quantity</th>

                    <th>Status</th>

                  </tr>

                </thead>


                <tbody>


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
                  Localhost
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


        {/* ================= REGISTER USER ================= */}

        {activeMenu === "Register User" && (
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
                      Wallet Address
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
