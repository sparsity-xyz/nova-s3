import { defineChain } from "viem";

export const skaleChain = defineChain({
    id: 324705682,
    name: "SKALE Base Sepolia",
    nativeCurrency: { decimals: 18, name: "Credits", symbol: "CREDIT" },
    rpcUrls: {
        default: { http: ["https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha"] },
    },
});
