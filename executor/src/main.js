const Web3 = require('web3');

const Monitor = require('./monitor.js');
const Conector = require('./conector.js');
const Handler = require('./handler.js');
const read = require('read')
const util = require('util');

async function main() {
    var web3 = new Web3("https://node.rcn.loans/");
    const conector = new Conector(web3);
    const monitor = new Monitor(web3);
    const handler = new Handler(web3);

    var pk = await util.promisify(read)({ prompt: 'Private key: ', silent: true, replace: "*" })
    pk = pk.startsWith('0x') ? pk : `0x${pk}`

    const account = web3.eth.accounts.privateKeyToAccount(pk)
    web3.eth.accounts.wallet.add(account);

    console.log(`Using account ${account.address}`)

    var rawOrders = [];
    var decodedOrders = {};

    monitor.onBlock(async (newBlock) => {
        const newOrders = await conector.getOrders(newBlock);
        rawOrders = rawOrders.concat(newOrders.filter((o) => rawOrders.indexOf(o) < 0));

        // Decode orders
        for (const i in rawOrders) {
            const rawOrder = rawOrders[i]
            if (decodedOrders[rawOrder] == undefined) {
                decodedOrders[rawOrder] = await handler.decode(rawOrder);
            }
        };

        var openOrders = [];

        // Filter open orders
        for (const i in rawOrders) {
            const rawOrder = rawOrders[i];
            if (await handler.exists(decodedOrders[rawOrder])) {
                openOrders.push(decodedOrders[rawOrder]);
            }
        };

        // Find filleable orders
        for (const i in openOrders) {
            const order = openOrders[i];

            if (await handler.isReady(order)) {
                // TODO Fill order
                await handler.fillOrder(order, account);
                // console.log(order);
            } else {
                console.log("not ready");
            }
        };
    });
}

main();