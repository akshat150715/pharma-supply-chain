// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract PharmaSupplyChain {

    // ============ ROLES ============

    enum Role {
        None,
        Manufacturer,
        Distributor,
        Pharmacy,
        Regulator
    }

    mapping(address => Role) public roles;

    // ============ BATCH STATUS ============

    enum BatchStatus {
        Created,
        InTransit,
        Sold,
        Recalled
    }

    // ============ STRUCTS ============

    struct MedicineBatch {
        uint256 id;
        string medicineName;
        string batchNumber;
        string manufacturerName;
        address manufacturerAddress;
        uint256 manufacturingDate;
        uint256 expiryDate;
        uint256 quantity;
        address currentOwner;
        address previousOwner;
        BatchStatus status;
        bool exists;
    }

    struct Transfer {
        address from;
        address to;
        uint256 timestamp;
        uint256 quantity;
    }

    // ============ STATE ============

    address public admin;

    uint256 private nextBatchId = 1;

    mapping(uint256 => MedicineBatch) private batches;
    mapping(uint256 => Transfer[]) private transferHistory;

    // ============ EVENTS ============

    event ParticipantRegistered(
        address indexed participant,
        Role role
    );

    event MedicineRegistered(
        uint256 indexed batchId,
        string medicineName,
        string batchNumber,
        address indexed manufacturer
    );

    event BatchTransferred(
        uint256 indexed batchId,
        address indexed from,
        address indexed to,
        uint256 quantity,
        uint256 timestamp
    );

    event BatchRecalled(
        uint256 indexed batchId,
        address indexed recalledBy,
        uint256 timestamp
    );

    // ============ MODIFIERS ============

    modifier onlyAdmin() {
        require(
            msg.sender == admin,
            "Only admin/regulator can perform this action"
        );
        _;
    }

    modifier onlyRole(Role _role) {
        require(
            roles[msg.sender] == _role,
            "Caller does not have the required role"
        );
        _;
    }

    modifier batchExists(uint256 _batchId) {
        require(
            batches[_batchId].exists,
            "Medicine batch does not exist"
        );
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor() {
        admin = msg.sender;
        roles[msg.sender] = Role.Regulator;

        emit ParticipantRegistered(msg.sender, Role.Regulator);
    }

    // ============ PARTICIPANT MANAGEMENT ============

    function registerParticipant(
        address _participant,
        Role _role
    )
        public
        onlyAdmin
    {
        require(
            _participant != address(0),
            "Invalid participant address"
        );

        require(
            _role != Role.None,
            "Cannot assign None as a role"
        );

        roles[_participant] = _role;

        emit ParticipantRegistered(_participant, _role);
    }

    function getRole(
        address _participant
    )
        public
        view
        returns (Role)
    {
        return roles[_participant];
    }

    // ============ MEDICINE / BATCH REGISTRATION ============

    function registerMedicine(
        string memory _medicineName,
        string memory _batchNumber,
        string memory _manufacturerName,
        uint256 _manufacturingDate,
        uint256 _expiryDate,
        uint256 _quantity
    )
        public
        onlyRole(Role.Manufacturer)
    {
        require(
            bytes(_medicineName).length > 0,
            "Medicine name required"
        );

        require(
            bytes(_batchNumber).length > 0,
            "Batch number required"
        );

        require(
            _quantity > 0,
            "Quantity must be greater than zero"
        );

        require(
            _expiryDate > _manufacturingDate,
            "Expiry must be after manufacturing date"
        );