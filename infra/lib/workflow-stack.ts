import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_lambda_nodejs as nodejs,
  aws_s3 as s3,
  aws_scheduler as scheduler,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_sqs as sqs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { join } from 'path';
import { TrafficCamEnv, addStandardTags, resourcePrefix } from './common';

export interface WorkflowStackProps extends cdk.StackProps {
  readonly envName: TrafficCamEnv;
  readonly detectionsTable: dynamodb.ITable;
  readonly camerasTable: dynamodb.ITable;
  readonly processedBucket: s3.IBucket;
  readonly alertEmail?: string;
}

export class WorkflowStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    const stackId = 'wf';
    const prefix = resourcePrefix(props.envName, stackId);
    const archivalTagKey = 'archivalRequired';

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `${prefix}-raw-bucket`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'RawTransition',
          enabled: true,
          tagFilters: {
            [archivalTagKey]: 'false',
          },
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(90),
            },
          ],
          expiration: Duration.days(365),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });
    addStandardTags(this.rawBucket, props.envName, stackId);

    const lambdaBasicPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole');

    const fetchCameraRole = new iam.Role(this, 'FetchCameraRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [lambdaBasicPolicy],
      roleName: `${prefix}-fetch-camera-role`,
    });
    addStandardTags(fetchCameraRole, props.envName, stackId);

    fetchCameraRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: ['*'],
      }),
    );

    const lambdaSource = (...segments: string[]) => join(__dirname, '..', 'src', 'lambdas', ...segments);

    const fetchCameraFn = new nodejs.NodejsFunction(this, 'FetchCameraListFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('fetch-camera', 'index.ts'),
      handler: 'handler',
      timeout: Duration.minutes(1),
      functionName: `${prefix}-fetch-camera-list`,
      role: fetchCameraRole,
      description: 'Fetches DigiTraffic camera stations, enriches presets, and filters them by distance.',
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });
    addStandardTags(fetchCameraFn, props.envName, stackId);

    const downloadRole = new iam.Role(this, 'DownloadImageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [lambdaBasicPolicy],
      roleName: `${prefix}-download-image-role`,
    });
    addStandardTags(downloadRole, props.envName, stackId);

    downloadRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: ['*'],
      }),
    );

    const downloadImageFn = new nodejs.NodejsFunction(this, 'DownloadImageFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('download-image', 'index.ts'),
      handler: 'handler',
      timeout: Duration.minutes(2),
      memorySize: 1024,
      functionName: `${prefix}-download-image`,
      environment: {
        RAW_BUCKET_NAME: this.rawBucket.bucketName,
      },
      role: downloadRole,
      description: 'Downloads DigiTraffic camera images and stores them in the raw bucket.',
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });
    this.rawBucket.grantWrite(downloadImageFn);
    addStandardTags(downloadImageFn, props.envName, stackId);

    const downloadDLQ = new sqs.Queue(this, 'DownloadDLQ', {
      queueName: `${prefix}-download-dlq`,
      retentionPeriod: Duration.days(14),
    });
    addStandardTags(downloadDLQ, props.envName, stackId);

    const downloadQueue = new sqs.Queue(this, 'DownloadQueue', {
      queueName: `${prefix}-download-queue`,
      visibilityTimeout: Duration.minutes(3),
      deadLetterQueue: {
        queue: downloadDLQ,
        maxReceiveCount: 3,
      },
    });
    addStandardTags(downloadQueue, props.envName, stackId);

    const analyzeRole = new iam.Role(this, 'AnalyzeImageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [lambdaBasicPolicy],
      roleName: `${prefix}-analyze-image-role`,
    });
    addStandardTags(analyzeRole, props.envName, stackId);

    analyzeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:traffic-cam/replicate-api-key-*`],
      }),
    );

    analyzeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: ['*'],
      }),
    );

    const analyzeImageFn = new nodejs.NodejsFunction(this, 'AnalyzeImageFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('analyze-image', 'index.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 2048,
      functionName: `${prefix}-analyze-image`,
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_NAME: 'traffic-cam/replicate-api-key',
        RAW_BUCKET_NAME: this.rawBucket.bucketName,
        PROCESSED_BUCKET_NAME: props.processedBucket.bucketName,
        DETECTIONS_TABLE_NAME: props.detectionsTable.tableName,
        CAMERAS_TABLE_NAME: props.camerasTable.tableName,
      },
      role: analyzeRole,
      description: 'Analyzes camera images using Replicate YOLO World XL model and stores detection results.',
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });
    this.rawBucket.grantRead(analyzeImageFn);
    props.processedBucket.grantWrite(analyzeImageFn);
        props.detectionsTable.grantWriteData(analyzeImageFn);
    props.camerasTable.grantReadWriteData(analyzeImageFn);
    addStandardTags(analyzeImageFn, props.envName, stackId);

    const analysisDLQ = new sqs.Queue(this, 'AnalysisDLQ', {
      queueName: `${prefix}-analysis-dlq`,
      retentionPeriod: Duration.days(14),
    });
    addStandardTags(analysisDLQ, props.envName, stackId);

    const analysisQueue = new sqs.Queue(this, 'AnalysisQueue', {
      queueName: `${prefix}-analysis-queue`,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: {
        queue: analysisDLQ,
        maxReceiveCount: 3,
      },
    });
    addStandardTags(analysisQueue, props.envName, stackId);

    const cameraFetchedRule = new events.Rule(this, 'CameraFetchedRule', {
      ruleName: `${prefix}-camera-fetched`,
      eventPattern: {
        source: ['traffic-cam.ingest'],
        detailType: ['CameraFetched'],
      },
    });
    cameraFetchedRule.addTarget(new targets.SqsQueue(downloadQueue));
    addStandardTags(cameraFetchedRule, props.envName, stackId);

    const imageDownloadedRule = new events.Rule(this, 'ImageDownloadedRule', {
      ruleName: `${prefix}-image-downloaded`,
      eventPattern: {
        source: ['traffic-cam.ingest'],
        detailType: ['ImageDownloaded'],
      },
    });
    imageDownloadedRule.addTarget(new targets.SqsQueue(analysisQueue));
    addStandardTags(imageDownloadedRule, props.envName, stackId);

    downloadImageFn.addEventSource(
      new eventSources.SqsEventSource(downloadQueue, {
        batchSize: 10,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      }),
    );

    analyzeImageFn.addEventSource(
      new eventSources.SqsEventSource(analysisQueue, {
        batchSize: 5,
        maxBatchingWindow: Duration.minutes(1),
        reportBatchItemFailures: true,
      }),
    );

    downloadQueue.grantConsumeMessages(downloadImageFn);
    analysisQueue.grantConsumeMessages(analyzeImageFn);

    // SNS Topic for detection alerts
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-detection-alerts`,
      displayName: 'Traffic Camera Detection Alerts',
    });
    addStandardTags(alertTopic, props.envName, stackId);

    // Subscribe email if provided
    if (props.alertEmail) {
      alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    }

    // Alert Lambda Function
    const alertRole = new iam.Role(this, 'AlertRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [lambdaBasicPolicy],
      roleName: `${prefix}-send-alert-role`,
    });
    addStandardTags(alertRole, props.envName, stackId);

    const sendAlertFn = new nodejs.NodejsFunction(this, 'SendAlertFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: lambdaSource('send-alert', 'index.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      functionName: `${prefix}-send-alert`,
      environment: {
        ALERT_TOPIC_ARN: alertTopic.topicArn,
        PROCESSED_BUCKET_NAME: props.processedBucket.bucketName,
      },
      role: alertRole,
      description: 'Sends email alerts when detections are found in camera images.',
      bundling: {
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        minify: true,
        sourcesContent: false,
      },
    });
    alertTopic.grantPublish(sendAlertFn);
    props.processedBucket.grantRead(sendAlertFn);
    addStandardTags(sendAlertFn, props.envName, stackId);

    // EventBridge rule for image analysis completion with detections
    const imageAnalyzedRule = new events.Rule(this, 'ImageAnalyzedRule', {
      ruleName: `${prefix}-image-analyzed`,
      eventPattern: {
        source: ['traffic-cam.analysis'],
        detailType: ['ImageAnalyzed'],
        detail: {
          detectionCount: [{ numeric: ['>', 0] }],
        },
      },
    });
    imageAnalyzedRule.addTarget(new targets.LambdaFunction(sendAlertFn));
    addStandardTags(imageAnalyzedRule, props.envName, stackId);

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      roleName: `${prefix}-scheduler-role`,
    });
    addStandardTags(schedulerRole, props.envName, stackId);

    fetchCameraFn.grantInvoke(schedulerRole);

    const ingestSchedule = new scheduler.CfnSchedule(this, 'IngestSchedule', {
      name: `${prefix}-ingest-schedule`,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0 9-16 * * ? *)',
      scheduleExpressionTimezone: 'Europe/Helsinki',
      target: {
        arn: fetchCameraFn.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ trigger: 'scheduled' }),
      },
    });

    addStandardTags(ingestSchedule, props.envName, stackId);

    addStandardTags(this, props.envName, stackId);
  }
}
