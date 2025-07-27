// === FILE: claim_fast_bot.js ===

const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

const PI_HORIZON = 'https://api.mainnet.minepi.com';
const server = new StellarSdk.Server(PI_HORIZON);
StellarSdk.Networks.PUBLIC;

const CLAIM_MNEMONIC = process.env.CLAIM_MNEMONIC;
const SPONSOR_MNEMONIC = process.env.SPONSOR_MNEMONIC;

(async () => {
  const claimKey = await getKeypairFromMnemonic(CLAIM_MNEMONIC);
  const sponsorKey = await getKeypairFromMnemonic(SPONSOR_MNEMONIC);

  console.log(`🚀 Fast Claim Bot dimulai. Akun: ${claimKey.publicKey()}`);

  while (true) {
    try {
      const balances = await getClaimableBalances(claimKey.publicKey());
      const claimableNow = balances.filter(b => isClaimableNow(b.claimants, claimKey.publicKey()));

      if (claimableNow.length > 0) {
        const tx = await buildClaimBatchTx(claimableNow, claimKey, sponsorKey);
        try {
          await sendTransaction(tx);
          console.log(`✅ Klaim ${claimableNow.length} saldo sukses`);
        } catch (err) {
          if (err.response?.data?.extras?.result_codes?.operations?.includes("op_claimable_balance_claimant_invalid")) {
            console.warn("⚠️ Beberapa saldo sudah diklaim bot lain");
          } else {
            console.error("❌ Gagal kirim transaksi klaim:", err.message);
          }
        }
      }
    } catch (err) {
      console.error("🌐 Gagal ambil saldo:", err.message);
    }
  }
})();

// 🔐 Ambil keypair dari mnemonic
async function getKeypairFromMnemonic(mnemonic) {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error("Mnemonic tidak valid!");
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derived = ed25519.derivePath("m/44'/314159'/0'", seed).key;
  return StellarSdk.Keypair.fromRawEd25519Seed(derived);
}

// 🌐 Ambil daftar claimable_balances
async function getClaimableBalances(address) {
  const res = await axios.get(`${PI_HORIZON}/claimable_balances?claimant=${address}&limit=200&order=asc`);
  return res.data._embedded?.records || [];
}

// ⏱️ Cek apakah bisa diklaim sekarang
function isClaimableNow(claimants, address) {
  const me = claimants.find(c => c.destination === address);
  if (!me) return false;
  const now = Math.floor(Date.now() / 1000);
  const notBefore = me?.predicate?.not?.abs_before_epoch;
  return !notBefore || now > parseInt(notBefore);
}

// ⚡ Bangun transaksi klaim batch cepat (maks 25)
async function buildClaimBatchTx(balances, claimKey, sponsorKey) {
  const account = await server.loadAccount(claimKey.publicKey());
  const fee = await server.fetchBaseFee();

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    feeAccount: sponsorKey.publicKey()
  }).setTimeout(30);

  const selected = balances.slice(0, 25);
  for (const b of selected) {
    txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: b.id }));
  }

  const tx = txBuilder.build();
  tx.sign(claimKey);
  tx.sign(sponsorKey);
  return tx;
}

// 🚀 Submit transaksi
async function sendTransaction(tx) {
  return await server.submitTransaction(tx);
}
