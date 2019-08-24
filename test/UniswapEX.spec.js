import assertRevert from './helpers/assertRevert'
import { balanceSnap, etherSnap } from './helpers/balanceSnap'

const BN = web3.utils.BN
const expect = require('chai').use(require('bn-chai')(BN)).expect

const UniswapEx = artifacts.require('UniswapEx')
const ERC20 = artifacts.require('FakeERC20')
const FakeUniswapFactory = artifacts.require('FakeUniswapFactory')
const UniswapFactory = artifacts.require('UniswapFactory')
const UniswapExchange = artifacts.require('UniswapExchange')
const VaultFactory = artifacts.require('VaultFactory')
const Vault = artifacts.require('Vault')

function buildCreate2Address(creatorAddress, saltHex, byteCode) {
  return `0x${web3.utils
    .soliditySha3(
      { t: 'bytes1', v: '0xff' },
      { t: 'address', v: creatorAddress },
      { t: 'bytes32', v: saltHex },
      {
        t: 'bytes32',
        v: web3.utils.soliditySha3({ t: 'bytes', v: byteCode })
      }
    )
    .slice(-40)}`.toLowerCase()
}

contract('UniswapEx', function ([_, owner, user, anotherUser, hacker]) {
  // globals
  const zeroAddress = '0x0000000000000000000000000000000000000000'
  const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const maxBn = new BN(2).pow(new BN(256)).sub(new BN(1));
  const fromOwner = { from: owner }
  const fromUser = { from: user }
  const fromAnotherUser = { from: anotherUser }
  const fromHacker = { from: hacker }

  const never = maxBn

  const creationParams = {
    ...fromOwner,
    gas: 6e6,
    gasPrice: 21e9
  }

  const fakeKey = web3.utils.sha3('0x01')
  const anotherFakeKey = web3.utils.sha3('0x02')
  const ONE_ETH = new BN(1)

  // Contracts
  let token1
  let token2
  let vaultFactory
  let uniswapEx
  let uniswapFactory
  let uniswapToken1
  let uniswapToken2

  beforeEach(async function () {
    // Create tokens
    token1 = await ERC20.new(creationParams)
    token2 = await ERC20.new(creationParams)
    // Deploy Uniswap
    uniswapFactory = await UniswapFactory.at((await FakeUniswapFactory.new()).address);
    await uniswapFactory.createExchange(token1.address);
    await uniswapFactory.createExchange(token2.address);
    uniswapToken1 = await UniswapExchange.at(await uniswapFactory.getExchange(token1.address));
    uniswapToken2 = await UniswapExchange.at(await uniswapFactory.getExchange(token2.address));
    // Deploy exchange
    uniswapEx = await UniswapEx.new(uniswapFactory.address, { from: owner })

    // Deploy vault
    vaultFactory = await VaultFactory.new(creationParams)
  })

  describe('Constructor', function () {
    it('should be depoyed', async function () {
      const contract = await UniswapEx.new(uniswapFactory.address)

      expect(contract).to.not.be.equal(zeroAddress)
    })
  })
  describe('It should trade on Uniswap', async function () {
    it('should execute buy tokens with ETH', async () => {
      // Add liquidity to Uniswap exchange
      await token1.setBalance(new BN(1000000000), owner)
      await token1.approve(uniswapToken1.address, maxBn, { from: owner })
      await uniswapToken1.addLiquidity(0, new BN(1000000000), never, { from: owner, value: new BN(5000000000) })

      // Create order
      const encodedOrder = await uniswapEx.encode(
        ethAddress,     // Sell ETH
        token1.address, // Buy TOKEN 1
        new BN(300),    // Get at least 300 Tokens
        new BN(10),     // Pay 10 WEI to sender
        user            // Owner of the order
      );

      await uniswapEx.depositETH(encodedOrder, { value: new BN(10000), from: user })

      // Take balance snapshots
      const exEtherSnap = await etherSnap(uniswapEx.address, "Uniswap EX");
      const executerEtherSnap = await etherSnap(anotherUser, "executer");
      const uniswapEtherSnap = await etherSnap(uniswapToken1.address, "uniswap");
      const userTokenSnap = await balanceSnap(token1, user, "user");
      const uniswapTokenSnap = await balanceSnap(token1, uniswapToken1.address, "uniswap");

      // Execute order
      const tx = await uniswapEx.execute(
        ethAddress,     // Sell ETH
        token1.address, // Buy TOKEN 1
        new BN(300),    // Get at least 300 Tokens
        new BN(10),     // Pay 10 WEI to sender
        user,           // Owner of the order
        {
          from: anotherUser,
          gasPrice: 0
        }
      );

      const bought = tx.logs[0].args._bought;

      // Validate balances
      await exEtherSnap.requireDecrease(new BN(10000));
      await executerEtherSnap.requireIncrease(new BN(10));
      await uniswapEtherSnap.requireIncrease(new BN(9990));
      await userTokenSnap.requireIncrease(bought);
      await uniswapTokenSnap.requireDecrease(bought);
    });
  });
  describe('Get vault', function () {
    it('should return correct vault', async function () {
      const address = (await vaultFactory.getVault(fakeKey)).toLowerCase()
      const expectedAddress = buildCreate2Address(
        vaultFactory.address,
        fakeKey,
        Vault.bytecode
      )
      expect(address).to.not.be.equal(zeroAddress)
      expect(address).to.be.equal(expectedAddress)
    })
    it('should return same vault for the same key', async function () {
      const address = await vaultFactory.getVault(fakeKey)
      const expectedAddress = await vaultFactory.getVault(fakeKey)
      expect(address).to.be.equal(expectedAddress)
    })
    it('should return a different vault for a different key', async function () {
      const address = await vaultFactory.getVault(fakeKey)
      const expectedAddress = await vaultFactory.getVault(anotherFakeKey)
      expect(address).to.not.be.equal(zeroAddress)
      expect(expectedAddress).to.not.be.equal(zeroAddress)
      expect(address).to.not.be.equal(expectedAddress)
    })
  })
  describe('Create vault', function () {
    it('should return correct vault', async function () {
      const address = await vaultFactory.getVault(fakeKey)
      await token1.setBalance(ONE_ETH, address)
      const tx = await vaultFactory.executeVault(fakeKey, token1.address, user)

      console.log(tx.rawLogs)
    })
    it('not revert if vault has no balance', async function () {
      await vaultFactory.executeVault(fakeKey, token1.address, user)
    })
  })
})
