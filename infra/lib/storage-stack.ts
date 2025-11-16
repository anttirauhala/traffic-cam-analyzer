import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { aws_dynamodb as dynamodb, aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TrafficCamEnv, addStandardTags, resourcePrefix } from './common';

export interface StorageStackProps extends cdk.StackProps {
  readonly envName: TrafficCamEnv;
}

export class StorageStack extends cdk.Stack {
  public readonly detectionsTable: dynamodb.Table;
  public readonly camerasTable: dynamodb.Table;
  public readonly processedBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const stackId = 'storage';
    const prefix = resourcePrefix(props.envName, stackId);
    const archivalTagKey = 'archivalRequired';

    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `${prefix}-processed-bucket`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ProcessedTransition',
          enabled: true,
          tagFilters: {
            [archivalTagKey]: 'false',
          },
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: Duration.days(180),
            },
          ],
          expiration: Duration.days(540),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });
    addStandardTags(this.processedBucket, props.envName, stackId);

    this.detectionsTable = new dynamodb.Table(this, 'ImageDetectionsTable', {
      tableName: `${prefix}-image-detections`,
      partitionKey: { name: 'cameraId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'capturedAtEpoch', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    this.detectionsTable.addGlobalSecondaryIndex({
      indexName: 'gsiHasWildlife',
      partitionKey: { name: 'hasWildlife', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'capturedAtEpoch', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.detectionsTable.addGlobalSecondaryIndex({
      indexName: 'gsiHasPerson',
      partitionKey: { name: 'hasPerson', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'capturedAtEpoch', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.detectionsTable.addGlobalSecondaryIndex({
      indexName: 'gsiProcessedAt',
      partitionKey: { name: 'processingStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'processedAtEpoch', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    addStandardTags(this.detectionsTable, props.envName, stackId);

    // Cameras table for fast camera lookups
    this.camerasTable = new dynamodb.Table(this, 'CamerasTable', {
      tableName: `${prefix}-cameras`,
      partitionKey: { name: 'cameraId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    addStandardTags(this.camerasTable, props.envName, stackId);
    addStandardTags(this, props.envName, stackId);
  }
}
