import solc from 'solc'; import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const input = { language: 'Solidity', sources: { 'CheckfeeSplitter.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors || []) console.error(e.severity, e.formattedMessage);
const c = out.contracts?.['CheckfeeSplitter.sol'] || {};
const res = {};
for (const n of Object.keys(c)) res[n] = { abi: c[n].abi, bytecode: '0x' + c[n].evm.bytecode.object };
fs.writeFileSync('out.json', JSON.stringify(res));
console.log(Object.keys(res).map(n => n + ' ' + (res[n].bytecode.length/2-1) + 'B').join('\n'));
