import sodium from "libsodium-wrappers";

function toB64(bytes: Uint8Array) {
  return sodium.to_base64(bytes);
}

function fromB64(text: string) {
  return sodium.from_base64(text);
}

export async function generateKeypair() {
  await sodium.ready;
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: toB64(keypair.publicKey),
    privateKey: toB64(keypair.privateKey)
  };
}

export async function publicKeyFromPrivateKey(privateKeyBase64: string) {
  await sodium.ready;
  const sk = fromB64(privateKeyBase64);
  const pk = sodium.crypto_scalarmult_base(sk);
  return toB64(pk);
}

export async function generateSecretKey() {
  await sodium.ready;
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  return toB64(key);
}

/**
 * Encrypt a symmetric key to a recipient's public key using a sealed box.
 * Recipient decrypts with their keypair.
 */
export async function sealToPublicKey(secretKeyBase64: string, recipientPublicKeyBase64: string) {
  await sodium.ready;
  const secretKey = fromB64(secretKeyBase64);
  const recipientPk = fromB64(recipientPublicKeyBase64);
  const sealed = sodium.crypto_box_seal(secretKey, recipientPk);
  return toB64(sealed);
}

/** Decrypt a sealed symmetric key using my keypair. */
export async function openSealedWithKeypair(
  sealedBase64: string,
  myPublicKeyBase64: string,
  myPrivateKeyBase64: string
) {
  await sodium.ready;
  const sealed = fromB64(sealedBase64);
  const pk = fromB64(myPublicKeyBase64);
  const sk = fromB64(myPrivateKeyBase64);
  const opened = sodium.crypto_box_seal_open(sealed, pk, sk);
  if (!opened) {
    throw new Error("Unable to decrypt conversation key with this device keypair");
  }
  return toB64(opened);
}

export async function encryptMessage(plainText: string, secretKeyBase64: string) {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const secretKey = fromB64(secretKeyBase64);
  const cipher = sodium.crypto_secretbox_easy(plainText, nonce, secretKey);
  return {
    cipherText: toB64(cipher),
    nonce: toB64(nonce)
  };
}

export async function decryptMessage(cipherTextBase64: string, nonceBase64: string, secretKeyBase64: string) {
  await sodium.ready;
  const cipher = fromB64(cipherTextBase64);
  const nonce = fromB64(nonceBase64);
  const secretKey = fromB64(secretKeyBase64);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, secretKey);
  if (!plain) {
    throw new Error("Unable to decrypt message with the current conversation key");
  }
  return sodium.to_string(plain);
}
