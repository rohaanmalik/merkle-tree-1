// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeusdMerkleDistributor} from "../src/DeusdMerkleDistributor.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract DeusdMerkleDistributorTest is Test {
    DeusdMerkleDistributor public distributor;
    ERC20Mock public token;

    // Test data from generated tree.json (matches existing Merkle.t.sol)
    bytes32 constant ROOT = 0xd154f63929fd3d7e582ec8155748bfd0805efc6cfbdf720bac4fee09cc162554;
    address constant TEST_ADDRESS = 0x31F22586537DF40aDAD550BaB056df61f4a2f93D;
    uint256 constant TEST_AMOUNT = 61;

    // Proof for index 0 in the included tree
    bytes32[3] proof;

    // Signer private key and address for tests
    uint256 internal signerPk;
    address internal signer;

    function setUp() public {
        // Prepare proof
        proof[0] = 0xdaa1c24c26a15e62d6a29f34160b31cf6bd974f869b3290d6d5ecc2311ed4a65;
        proof[1] = 0xf0b481b32d0812b6e079a43fbb822e795a3ddca32e9b89a0d5bd4dc12ad4feca;
        proof[2] = 0x568d3d65c84049e144a7287c817713a5b15decb8c5bceebecc0e17b3130e2f25;

        // Create token and mint to this test contract
        token = new ERC20Mock();
        token.mint(address(this), 1_000_000 ether);

        // Setup signer
        signerPk = 0xA11CE;
        signer = vm.addr(signerPk);

        // Deploy distributor with 1-year window from now
        distributor = new DeusdMerkleDistributor(ROOT, address(token), address(this), signer);

        // Fund distributor
        token.transfer(address(distributor), 1000 ether);
    }

    function _signature(address claimer, uint256 amount) internal view returns (bytes memory sig) {
        bytes32 messageHash = keccak256(abi.encodePacked(claimer, amount, address(distributor), block.chainid));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethHash);
        sig = abi.encodePacked(r, s, v);
    }

    function test_Claim_Succeeds() public {
        // Build calldata
        bytes memory sig = _signature(TEST_ADDRESS, TEST_AMOUNT);

        // Expect balances
        uint256 beforeBal = token.balanceOf(TEST_ADDRESS);

        // Prank as the claimer and claim
        vm.prank(TEST_ADDRESS);
        distributor.claim(TEST_AMOUNT, _toDyn(proof), sig);

        uint256 afterBal = token.balanceOf(TEST_ADDRESS);
        assertEq(afterBal - beforeBal, TEST_AMOUNT);

        // Prevent double-claim
        vm.prank(TEST_ADDRESS);
        vm.expectRevert(DeusdMerkleDistributor.AlreadyClaimed.selector);
        distributor.claim(TEST_AMOUNT, _toDyn(proof), sig);
    }

    function test_Claim_Reverts_After_End() public {
        // Warp to claim end + 1
        vm.warp(distributor.CLAIM_END() + 1);
        bytes memory sig = _signature(TEST_ADDRESS, TEST_AMOUNT);
        vm.prank(TEST_ADDRESS);
        vm.expectRevert(DeusdMerkleDistributor.ClaimFinished.selector);
        distributor.claim(TEST_AMOUNT, _toDyn(proof), sig);
    }

    function test_Withdraw_Owner() public {
        uint256 ownerBefore = token.balanceOf(address(this));
        distributor.withdraw(100 ether);
        uint256 ownerAfter = token.balanceOf(address(this));
        assertEq(ownerAfter - ownerBefore, 100 ether);
    }

    function _toDyn(bytes32[3] memory arr) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](3);
        out[0] = arr[0];
        out[1] = arr[1];
        out[2] = arr[2];
    }
}
