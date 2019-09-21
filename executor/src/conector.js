const factory_abi = require('./interfaces/uniswapFactory.js');
const uniswapex_abi = require('./interfaces/uniswapEx.js');
const ierc20_abi = require('./interfaces/ierc20.js');
const retry = require('./retry.js');
const env = require('../env.js');

const MAX_JUMP = 10000000;
module.exports = class Conector {
    constructor(w3) {
        this.w3 = w3;
        this.uni_factory = new w3.eth.Contract(factory_abi, env.uniswapFactory);
        this.uniswap_ex = new w3.eth.Contract(uniswapex_abi, env.uniswapEx);
        this.last_monitored = 8549023;
        this.uniswap_token_cache = {}
    }

    async getSafePastEvents(contract, name, fromBlock, toBlock) {
        try {
            return await contract.getPastEvents(name, {
                fromBlock: fromBlock,
                toBlock: toBlock
            });
        } catch (e) {
            if (fromBlock != toBlock && e.toString().includes("more than 10000 results")) {
                const pivot = Math.floor(fromBlock + (toBlock - fromBlock) / 2);
                console.log(`${contract._address} - Split event query in two ${fromBlock}-${toBlock} -> ${pivot}`);

                const a = await this.getSafePastEvents(
                    contract,
                    name,
                    fromBlock,
                    pivot
                );

                const b = await this.getSafePastEvents(
                    contract,
                    name,
                    pivot,
                    toBlock
                );

                const result = a.concat(b);

                console.log(`${contract._address} - Split event query in two ${fromBlock}-${toBlock} -> ${pivot} : found ${result.length}`);
                return result;
            } else {
                throw e;
            }
        }
    }

    async getUniswapAddress(i) {
        if (this.uniswap_token_cache[i] != undefined) {
            return this.uniswap_token_cache[i];
        }

        const token_addr = await retry(this.uni_factory.methods.getTokenWithId(i).call());
        this.uniswap_token_cache[i] = token_addr;
        return token_addr;
    }

    async getOrders(toBlock) {
        toBlock = Math.min(toBlock, this.last_monitored + MAX_JUMP);

        const total = await retry(this.uni_factory.methods.tokenCount().call());

        const orders = [];
        var tokensChecked = 0;

        // Load ETH orders
        const events = await retry(this.getSafePastEvents(
            this.uniswap_ex,
            'DepositETH',
            this.last_monitored,
            toBlock
        ));

        for (let i in events) {
            const event = events[i];
            console.log('Found ETH Order')
            orders.push(event.returnValues._data);
        }

        // Load events of all Uniswap tokens
        for (var i = 1; i < total; i++) {
            const token_addr = await this.getUniswapAddress(i);
            tokensChecked++;

            // Skip USDT
            if (token_addr.toLowerCase() == "0xdac17f958d2ee523a2206206994597c13d831ec7") {
                continue
            }

            console.log(`${tokensChecked}/${total} - Monitoring token ${token_addr}`);
            const token = new this.w3.eth.Contract(ierc20_abi, token_addr);
            const events = await retry(this.getSafePastEvents(
                token,
                'Transfer',
                this.last_monitored,
                toBlock
            ));

            const checked = []
            var checkedCount = 0

            for (let i in events) {
                const event = events[i];

                const tx = event.transactionHash;
                checkedCount += 1

                if (checked.includes(tx)) {
                    continue
                }

                const full_tx = await retry(this.w3.eth.getTransaction(tx));
                const tx_data = full_tx.input;

                console.log(`${checkedCount}/${events.length} - Check TX ${tx}`)
                if (tx_data.startsWith("0xa9059cbb") && tx_data.length == 714) {
                    orders.push(tx_data)
                    console.log(`Found order TX ${tx}`)
                }

                checked.push(tx);
            }
        }

        this.last_monitored = toBlock;
        return orders;
    }
}
