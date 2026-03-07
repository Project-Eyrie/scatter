// Deflate compression and base64url encoding for compact URL state storage

// Reads all chunks from a ReadableStream into a single Uint8Array
async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

// Compresses a string using DeflateRaw via CompressionStream API
export async function deflateCompress(input: string): Promise<Uint8Array> {
	const stream = new Blob([new TextEncoder().encode(input)])
		.stream()
		.pipeThrough(new CompressionStream('deflate-raw'));
	return readStream(stream);
}

// Decompresses a DeflateRaw-compressed Uint8Array back to a string
export async function deflateDecompress(compressed: Uint8Array): Promise<string> {
	const stream = new Blob([compressed as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'));
	return new TextDecoder().decode(await readStream(stream));
}

// Converts Uint8Array to URL-safe base64 without padding
export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Converts URL-safe base64 back to Uint8Array
export function fromBase64Url(str: string): Uint8Array {
	let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
	while (b64.length % 4 !== 0) b64 += '=';
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;

// Derives an AES-GCM key from a password and salt using PBKDF2
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

// Encrypts data with AES-GCM using a password-derived key, returns salt + iv + ciphertext
export async function encryptData(data: Uint8Array, password: string): Promise<Uint8Array> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(password, salt);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
	result.set(salt, 0);
	result.set(iv, SALT_LENGTH);
	result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);
	return result;
}

// Decrypts AES-GCM encrypted data from salt + iv + ciphertext format
export async function decryptData(encrypted: Uint8Array, password: string): Promise<Uint8Array> {
	const salt = encrypted.slice(0, SALT_LENGTH);
	const iv = encrypted.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const ciphertext = encrypted.slice(SALT_LENGTH + IV_LENGTH);
	const key = await deriveKey(password, salt);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new Uint8Array(plaintext);
}
