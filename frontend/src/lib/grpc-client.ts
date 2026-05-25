import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const DECRYPTION_URL = process.env.DECRYPTION_URL || '34.84.204.187:38085';
const ALPHA_TRION_URL = process.env.ALPHA_TRION_URL || 'http://34.84.204.187:38081';

// 使用绝对路径加载 proto 文件
const protoPath = path.resolve(process.cwd(), 'proto', 'decryption.proto');
console.log('[grpc-client] protoPath:', protoPath);

let decryptionProto: any;

try {
  const packageDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  decryptionProto = grpc.loadPackageDefinition(packageDef) as any;
} catch (err: any) {
  console.error('[grpc-client] Failed to load proto:', err.message);
}

interface DecryptionResult {
  handle: string;
  value: string;
}

export async function decryptViaGrpc(payload: any): Promise<DecryptionResult[]> {
  if (!decryptionProto) {
    throw new Error('gRPC proto not loaded');
  }

  const client = new decryptionProto.decryption.DecryptionService(
    DECRYPTION_URL,
    grpc.credentials.createInsecure(),
    {
      'grpc.max_receive_message_length': -1,
      'grpc.max_send_message_length': -1,
    }
  );

  const queryParams = JSON.stringify([payload]);
  const ciphertext = {
    query_params: queryParams,
    query_url: ALPHA_TRION_URL,
    query_method: 'query_for_decryption',
  };

  console.log('[grpc-client] sending decrypt request:', { queryParams, query_url: ALPHA_TRION_URL });

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    client.DecryptHandle({ ciphertext }, { deadline }, (err: any, response: any) => {
      if (err) {
        console.error('[grpc-client] DecryptHandle error:', err.message);
        reject(new Error(`gRPC error: ${err.message}`));
        return;
      }

      console.log('[grpc-client] DecryptHandle response:', response);

      const result = (response?.plaintexts || []).map((p: any) => ({
        handle: p.handle,
        value: p.plaintext,
      }));

      resolve(result);
      client.close();
    });
  });
}