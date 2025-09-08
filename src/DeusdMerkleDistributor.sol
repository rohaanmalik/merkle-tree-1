// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title DeusdMerkleDistributor
/// @notice Merkle-based claim contract for an existing ERC20 (DEUSD). Uses signatures and a 1-year claim window.
contract DeusdMerkleDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a user claims tokens.
    /// @param user The user address.
    /// @param amount The amount of tokens claimed.
    event Claimed(address indexed user, uint256 amount);

    /// @notice Emitted when the owner withdraws tokens.
    /// @param owner The owner address.
    /// @param amount The amount of tokens withdrawn.
    event Withdrawn(address indexed owner, uint256 amount);

    /// @notice Emitted when the signer is set.
    /// @param signer The signer address.
    event SignerUpdated(address indexed signer);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidAmount();
    error AlreadyClaimed();
    error InvalidProof();
    error InvalidToken();
    error EmptyProof();
    error ClaimFinished();
    error InvalidSignature();

    /*//////////////////////////////////////////////////////////////
                           IMMUTABLE STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The merkle root hash.
    bytes32 public immutable MERKLE_ROOT;

    /// @notice The token contract.
    IERC20 public immutable TOKEN;

    /// @notice The timestamp when the claim period ends (deployment + 365 days).
    uint256 public immutable CLAIM_END;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The signer address.
    address public signer;

    /// @notice Mapping of claimed status.
    mapping(address user => bool claimed) public hasClaimed;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Define the merkle root, token, owner, and optional initial signer.
    /// @param _merkleRoot The merkle root hash.
    /// @param _token The token address (DEUSD).
    /// @param _owner The owner address.
    /// @param _signer The initial signer address (can be updated later).
    constructor(bytes32 _merkleRoot,
                address _token,
                address _owner,
                address _signer
    ) Ownable(_owner) {
        if (_token == address(0)) revert InvalidToken();
        MERKLE_ROOT = _merkleRoot;
        TOKEN = IERC20(_token);
        CLAIM_END = block.timestamp + 365 days;
        signer = _signer;
    }

    /*//////////////////////////////////////////////////////////////
                             VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Verifies a proof for a given account and amount using the stored root.
    function verify(bytes32[] calldata proof, address account, uint256 amount) external view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        return MerkleProof.verify(proof, MERKLE_ROOT, leaf);
    }

    /*//////////////////////////////////////////////////////////////
                           EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim tokens using a signature and merkle proof.
    /// @param _amount Amount of tokens to claim.
    /// @param _merkleProof Merkle proof of claim (leaf = keccak256(bytes.concat(keccak256(abi.encode(claimer, amount))))).
    /// @param _signature Signature of the claim (signer over packed(claimer, amount, this, chainid)).
    function claim(uint256 _amount, bytes32[] calldata _merkleProof, bytes calldata _signature) external {
        if (_amount == 0) revert InvalidAmount();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        if (_merkleProof.length == 0) revert EmptyProof();
        if (block.timestamp >= CLAIM_END) revert ClaimFinished();

        _signatureCheck(_amount, _signature, msg.sender);

        // Generate the leaf and verify the merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, _amount))));
        if (!MerkleProof.verify(_merkleProof, MERKLE_ROOT, leaf)) revert InvalidProof();

        // Mark as claimed and transfer tokens
        hasClaimed[msg.sender] = true;
        TOKEN.safeTransfer(msg.sender, _amount);

        emit Claimed(msg.sender, _amount);
    }

    /// @notice Set the signer address.
    /// @param _signer The signer address.
    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    /// @notice Withdraw tokens from the contract.
    function withdraw(uint256 amount) external onlyOwner {
        TOKEN.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Internal function to check the signature
    /// @param _amount amount of tokens to claim
    /// @param _signature signature of the claim
    /// @param _onBehalfOf address of the user claiming the airdrop
    function _signatureCheck(uint256 _amount, bytes calldata _signature, address _onBehalfOf) internal view {
        if (_signature.length == 0) revert InvalidSignature();

        bytes32 messageHash = keccak256(abi.encodePacked(_onBehalfOf, _amount, address(this), block.chainid));
        bytes32 prefixedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recoveredSigner = ECDSA.recover(prefixedHash, _signature);

        if (recoveredSigner != signer) revert InvalidSignature();
    }
}
