// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract Merkle {
    bytes32 public immutable ROOT;

    constructor(bytes32 _root) {
        ROOT = _root;
    }

    function verify(bytes32[] calldata proof, address account, uint256 amount) public view returns (bool) {
        bytes32 leafHash = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        return MerkleProof.verify(proof, ROOT, leafHash);
    }
}
