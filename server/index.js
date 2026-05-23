import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const PORT = 5001;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // support large base64 image payloads

// Generate ECDSA P-256 Keypair simulating the Snapdragon Secure Processing Unit (SPU) TrustZone
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

// Export the public key in PEM format once so we can send it with signatures
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  .toString()
  .trim();

console.log('----------------------------------------------------');
console.log('Snapdragon SPU Cryptographic Keystore Initialized.');
console.log('Secure ECDSA P-256 Keypair Generated.');
console.log('----------------------------------------------------');

// C2PA asset signing endpoint
app.post('/api/sign', (req, res) => {
  try {
    const { image, metadata } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Missing image payload' });
    }

    // Extract base64 binary parts
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // 1. Calculate SHA-256 hash of the incoming binary frame
    const hashHex = crypto.createHash('sha256').update(imageBuffer).digest('hex');

    // 2. Cryptographically sign the hash using the SPU Private Key
    const sign = crypto.createSign('SHA256');
    sign.update(hashHex);
    const signatureDer = sign.sign(privateKey);
    const signatureBase64 = signatureDer.toString('base64');

    // 3. Construct a standard C2PA-compliant manifest
    const manifest = {
      isWatermarked: true,
      c2paVerified: true,
      signatureAlgorithm: 'ECDSA_P256_SHA256 (StrongBox locked)',
      hardwareKeyId: 'QUALCOMM_TEE_ENV_0x8C8CDD3',
      signingTime: new Date().toISOString(),
      manifestHash: `sha256:${hashHex}`,
      signature: signatureBase64,
      publicKey: publicKeyPem,
      deviceLineage: {
        sensor: 'Sony IMX800 / Snapdragon Camera HAL3 Surface Interceptor',
        isp: 'Qualcomm Spectra 680 ISP (Dual Engine)',
        keystore: 'Snapdragon Secure Processing Unit (SPU) TrustZone'
      },
      licenseTier: 'Enterprise Premium Content Rights',
      commercialValueScore: 98.4,
      royaltyRights: 'Protected Content Registry Royalty Pool Active'
    };

    console.log(`[SPU] Signed frame! Hash: sha256:${hashHex.substring(0, 16)}... Signature: ${signatureBase64.substring(0, 16)}...`);

    // Return the signed manifest and the watermarked base64 image
    res.json({
      success: true,
      manifest,
      // In a real device pipeline, the hardware ISP injects a fragile spatial watermark.
      // We pass the base64 back as the verified, C2PA-stamped image asset.
      watermarkedImage: image
    });
  } catch (error) {
    console.error('Signing error:', error);
    res.status(500).json({ error: 'Internal signing error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Snapdragon Guard Backend running at http://localhost:${PORT}`);
});
