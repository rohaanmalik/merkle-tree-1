// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Merkle} from "../src/Merkle.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        bytes32 merkleRoot = vm.envBytes32("MERKLE_ROOT");
        
        vm.startBroadcast(deployerPrivateKey);
        
        Merkle merkle = new Merkle(merkleRoot);
        
        console.log("Deployed Merkle at:", address(merkle));
        console.log("Merkle Root:", vm.toString(merkleRoot));
        
        vm.stopBroadcast();
    }
}