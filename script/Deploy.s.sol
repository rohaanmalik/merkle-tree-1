// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DeusdMerkleDistributor} from "../src/DeusdMerkleDistributor.sol";

contract Deploy is Script {
    function run() external {
        bytes32 merkleRoot = 0xe69b7d0fbf874c11b3ce0511af8bb38fb24ec6da2f1ce1da5af941d963e28d7c;

        vm.startBroadcast();

        address token = 0xa6B08f1B0d894429Ed73fB68F0330318b188e2B0;
        address owner = 0x85F45B3Ab65132b38b71e19fF9cF33106217a644;
        address signer = 0x85F45B3Ab65132b38b71e19fF9cF33106217a644;

        DeusdMerkleDistributor distributor = new DeusdMerkleDistributor{
            salt: keccak256(abi.encodePacked("DeusdMerkleDistributorV2"))
        }(merkleRoot, token, owner, signer);

        vm.stopBroadcast();
    }
}
