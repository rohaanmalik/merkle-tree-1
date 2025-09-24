// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DeusdMerkleDistributor} from "../src/DeusdMerkleDistributor.sol";

contract Deploy is Script {
    function run() external {
        bytes32 merkleRoot = 0x7276a4400cf2731c22019038e2a1b51d143454c3e9318ab79567a4ad60c7b07a;

        vm.startBroadcast();

        address token = 0xa6B08f1B0d894429Ed73fB68F0330318b188e2B0;
        address owner = 0x85F45B3Ab65132b38b71e19fF9cF33106217a644;
        address signer = 0x85F45B3Ab65132b38b71e19fF9cF33106217a644;

        DeusdMerkleDistributor distributor = new DeusdMerkleDistributor{
            salt: keccak256(abi.encodePacked("DeusdMerkleDistributorV1"))
        }(merkleRoot, token, owner, signer);

        vm.stopBroadcast();
    }
}
