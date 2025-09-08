// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Merkle} from "../src/Merkle.sol";

contract MerkleTest is Test {
    Merkle public merkle;

    // Test data from generated tree.json
    bytes32 constant ROOT = 0xd154f63929fd3d7e582ec8155748bfd0805efc6cfbdf720bac4fee09cc162554;
    address constant TEST_ADDRESS = 0x31F22586537DF40aDAD550BaB056df61f4a2f93D;
    uint256 constant TEST_AMOUNT = 61;

    function setUp() public {
        merkle = new Merkle(ROOT);
    }

    function test_MerkleRoot() public view {
        assertEq(merkle.ROOT(), ROOT);
    }

    function test_Verify() public view {
        // Create proof from generated data
        bytes32[] memory proof = new bytes32[](3);
        proof[0] = 0xdaa1c24c26a15e62d6a29f34160b31cf6bd974f869b3290d6d5ecc2311ed4a65;
        proof[1] = 0xf0b481b32d0812b6e079a43fbb822e795a3ddca32e9b89a0d5bd4dc12ad4feca;
        proof[2] = 0x568d3d65c84049e144a7287c817713a5b15decb8c5bceebecc0e17b3130e2f25;

        bool isValid = merkle.verify(proof, TEST_ADDRESS, TEST_AMOUNT);
        assertTrue(isValid, "Proof should be valid");
    }
}
