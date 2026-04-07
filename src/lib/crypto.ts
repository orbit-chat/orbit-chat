import sodium from "libsodium-wrappers";

export async function generateKeypair() {
  await sodium.ready;
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey)
  };
}

export async function encryptMessage(plainText: string, secretKeyBase64: string) {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const secretKey = sodium.from_base64(secretKeyBase64);
  const cipher = sodium.crypto_secretbox_easy(plainText, nonce, secretKey);
  return {
    cipherText: sodium.to_base64(cipher),
    nonce: sodium.to_base64(nonce)
  };
}

export async function decryptMessage(cipherTextBase64: string, nonceBase64: string, secretKeyBase64: string) {
  await sodium.ready;
  const cipher = sodium.from_base64(cipherTextBase64);
  const nonce = sodium.from_base64(nonceBase64);
  const secretKey = sodium.from_base64(secretKeyBase64);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, secretKey);
  return sodium.to_string(plain);
}
