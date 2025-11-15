import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { GetImageUrlResponse } from '../../shared/api-types';

const RAW_BUCKET_NAME = process.env.RAW_BUCKET_NAME;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME;
const URL_EXPIRATION_SECONDS = 3600; // 1 hour

if (!RAW_BUCKET_NAME || !PROCESSED_BUCKET_NAME) {
  throw new Error('Missing required environment variables: RAW_BUCKET_NAME, PROCESSED_BUCKET_NAME');
}

const s3Client = new S3Client({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

const errorResponse = (statusCode: number, message: string): APIGatewayProxyResult => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify({ error: 'Error', message }),
});

const successResponse = (data: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify(data),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  // Handle OPTIONS for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const { bucket, key } = params;

    if (!bucket || !key) {
      return errorResponse(400, 'Missing required query parameters: bucket and key');
    }

    if (bucket !== 'raw' && bucket !== 'processed') {
      return errorResponse(400, 'Invalid bucket. Must be "raw" or "processed"');
    }

    const bucketName = bucket === 'raw' ? RAW_BUCKET_NAME : PROCESSED_BUCKET_NAME;

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRATION_SECONDS });

    const response: GetImageUrlResponse = {
      url,
      expiresIn: URL_EXPIRATION_SECONDS,
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return errorResponse(500, 'Internal server error');
  }
};
