import * as cdk from 'aws-cdk-lib';
import {
  aws_apigateway as apigw,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda_nodejs as nodejs,
  aws_lambda as lambda,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { join } from 'path';
import { TrafficCamEnv, addStandardTags, resourcePrefix } from './common';

export interface ApiStackProps extends cdk.StackProps {
  readonly envName: TrafficCamEnv;
  readonly detectionsTable: dynamodb.ITable;
  readonly camerasTable: dynamodb.ITable;
  readonly rawBucket: s3.IBucket;
  readonly processedBucket: s3.IBucket;
}

const lambdaSource = (name: string, filename: string) => join(__dirname, '..', 'src', 'lambdas', name, filename);

export class ApiStack extends cdk.Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const stackId = 'api';
    const prefix = resourcePrefix(props.envName, stackId);

    // API Gateway REST API
    this.api = new apigw.RestApi(this, 'DetectionsApi', {
      restApiName: `${prefix}-detections-api`,
      description: 'REST API for querying traffic camera detection results',
      deployOptions: {
        stageName: props.envName,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    addStandardTags(this.api, props.envName, stackId);

    // Usage Plan with Rate Limiting
    const usagePlan = this.api.addUsagePlan('UsagePlan', {
      name: `${prefix}-usage-plan`,
      description: 'Rate limiting for traffic camera API',
      throttle: {
        rateLimit: 50,
        burstLimit: 100,
      },
      quota: {
        limit: 10000,
        period: apigw.Period.DAY,
      },
    });

    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    addStandardTags(usagePlan, props.envName, stackId);

    // Lambda: List Detections
    const listDetectionsFn = new nodejs.NodejsFunction(this, 'ListDetectionsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('api-list-detections', 'index.ts'),
      handler: 'handler',
      functionName: `${prefix}-list-detections`,
      environment: {
        DETECTIONS_TABLE_NAME: props.detectionsTable.tableName,
        WILDLIFE_GSI_NAME: 'hasWildlife-capturedAtEpoch-index',
        PERSON_GSI_NAME: 'hasPerson-capturedAtEpoch-index',
      },
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });

    props.detectionsTable.grantReadData(listDetectionsFn);
    addStandardTags(listDetectionsFn, props.envName, stackId);

    // Lambda: Get Detection
    const getDetectionFn = new nodejs.NodejsFunction(this, 'GetDetectionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('api-get-detection', 'index.ts'),
      handler: 'handler',
      functionName: `${prefix}-get-detection`,
      environment: {
        DETECTIONS_TABLE_NAME: props.detectionsTable.tableName,
      },
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });

    props.detectionsTable.grantReadData(getDetectionFn);
    addStandardTags(getDetectionFn, props.envName, stackId);

    // Lambda: List Cameras
    const listCamerasFn = new nodejs.NodejsFunction(this, 'ListCamerasFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('api-list-cameras', 'index.ts'),
      handler: 'handler',
      functionName: `${prefix}-list-cameras`,
      environment: {
        CAMERAS_TABLE_NAME: props.camerasTable.tableName,
      },
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });

    props.camerasTable.grantReadData(listCamerasFn);
    addStandardTags(listCamerasFn, props.envName, stackId);

    // Lambda: List Camera Timestamps
    const listCameraTimestampsFn = new nodejs.NodejsFunction(this, 'ListCameraTimestampsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('api-list-camera-timestamps', 'index.ts'),
      handler: 'handler',
      functionName: `${prefix}-list-camera-timestamps`,
      environment: {
        DETECTIONS_TABLE_NAME: props.detectionsTable.tableName,
      },
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });

    props.detectionsTable.grantReadData(listCameraTimestampsFn);
    addStandardTags(listCameraTimestampsFn, props.envName, stackId);

    // Lambda: Get Image URL
    const getImageUrlFn = new nodejs.NodejsFunction(this, 'GetImageUrlFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('api-get-image-url', 'index.ts'),
      handler: 'handler',
      functionName: `${prefix}-get-image-url`,
      environment: {
        RAW_BUCKET_NAME: props.rawBucket.bucketName,
        PROCESSED_BUCKET_NAME: props.processedBucket.bucketName,
      },
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });

    props.rawBucket.grantRead(getImageUrlFn);
    props.processedBucket.grantRead(getImageUrlFn);
    addStandardTags(getImageUrlFn, props.envName, stackId);

    // API Gateway Resources and Methods
    const detections = this.api.root.addResource('detections');
    detections.addMethod('GET', new apigw.LambdaIntegration(listDetectionsFn));

    const detection = detections.addResource('{cameraId}').addResource('{timestamp}');
    detection.addMethod('GET', new apigw.LambdaIntegration(getDetectionFn));

    const cameras = this.api.root.addResource('cameras');
    cameras.addMethod('GET', new apigw.LambdaIntegration(listCamerasFn));

    const camera = cameras.addResource('{cameraId}');
    const timestamps = camera.addResource('timestamps');
    timestamps.addMethod('GET', new apigw.LambdaIntegration(listCameraTimestampsFn));

    const images = this.api.root.addResource('images');
    images.addMethod('GET', new apigw.LambdaIntegration(getImageUrlFn));

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${prefix}-api-url`,
    });

    addStandardTags(this, props.envName, stackId);
  }
}
