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

        batches[nextBatchId] = MedicineBatch({
            id: nextBatchId,
            medicineName: _medicineName,
            batchNumber: _batchNumber,
            manufacturerName: _manufacturerName,
            manufacturerAddress: msg.sender,
            manufacturingDate: _manufacturingDate,
            expiryDate: _expiryDate,
            quantity: _quantity,
            currentOwner: msg.sender,
            previousOwner: address(0),
            status: BatchStatus.Created,
            exists: true
        });

        emit MedicineRegistered(
            nextBatchId,
            _medicineName,
            _batchNumber,
            msg.sender
        );

        nextBatchId++;
    }

    // ============ SUPPLY CHAIN TRANSFER ============

    function transferBatch(
        uint256 _batchId,
        address _to
    )
        public
        batchExists(_batchId)
    {
        MedicineBatch storage batch = batches[_batchId];

        require(
            batch.status != BatchStatus.Recalled,
            "Cannot transfer a recalled batch"
        );

        require(
            batch.currentOwner == msg.sender,
            "Only the current owner can transfer this batch"
        );

        require(
            _to != address(0),
            "Invalid recipient address"
        );

        Role senderRole = roles[msg.sender];
        Role recipientRole = roles[_to];

        if (senderRole == Role.Manufacturer) {
            require(
                recipientRole == Role.Distributor,
                "Manufacturer can only transfer to a registered Distributor"
            );
            batch.status = BatchStatus.InTransit;

        } else if (senderRole == Role.Distributor) {
            require(
                recipientRole == Role.Pharmacy,
                "Distributor can only transfer to a registered Pharmacy"
            );
            batch.status = BatchStatus.InTransit;

        } else if (senderRole == Role.Pharmacy) {
            batch.status = BatchStatus.Sold;

        } else {
            revert("Caller role is not authorized to transfer batches");
        }

        batch.previousOwner = batch.currentOwner;
        batch.currentOwner = _to;

        transferHistory[_batchId].push(Transfer({
            from: msg.sender,
            to: _to,
            timestamp: block.timestamp,
            quantity: batch.quantity
        }));

        emit BatchTransferred(
            _batchId,
            msg.sender,
            _to,
            batch.quantity,
            block.timestamp
        );
    }

    // ============ RECALL MANAGEMENT ============

    function recallBatch(
        uint256 _batchId
    )
        public
        onlyAdmin
        batchExists(_batchId)
    {
        batches[_batchId].status = BatchStatus.Recalled;

        emit BatchRecalled(_batchId, msg.sender, block.timestamp);
    }

    // ============ READ / VERIFICATION FUNCTIONS ============

    function getMedicine(
        uint256 _batchId
    )
        public
        view
        batchExists(_batchId)
        returns (MedicineBatch memory)
    {
        return batches[_batchId];
    }

    function getTransferHistory(
        uint256 _batchId
    )
        public
        view
        batchExists(_batchId)
        returns (Transfer[] memory)
    {
        return transferHistory[_batchId];
    }

    function getTotalBatches()
        public
        view
        returns (uint256)
    {
        return nextBatchId - 1;
    }

    function isExpired(
        uint256 _batchId
    )
        public
        view
        batchExists(_batchId)
        returns (bool)
    {
        return block.timestamp > batches[_batchId].expiryDate;
    }

    function verifyBatch(
        uint256 _batchId
    )
        public
        view
        returns (
            bool exists,
            string memory medicineName,
            string memory batchNumber,
            string memory manufacturerName,
            uint256 manufacturingDate,
            uint256 expiryDate,
            address currentOwner,
            BatchStatus status,
            bool expired,
            bool authentic
        )
    {
        MedicineBatch memory batch = batches[_batchId];

        if (!batch.exists) {
            return (
                false,
                "",
                "",
                "",
                0,
                0,
                address(0),
                BatchStatus.Created,
                false,
                false
            );
        }

        bool isExpiredNow = block.timestamp > batch.expiryDate;
        bool isAuthentic = batch.status != BatchStatus.Recalled && !isExpiredNow;

        return (
            true,
            batch.medicineName,
            batch.batchNumber,
            batch.manufacturerName,
            batch.manufacturingDate,
            batch.expiryDate,
            batch.currentOwner,
            batch.status,
            isExpiredNow,
            isAuthentic
        );
    }
}
