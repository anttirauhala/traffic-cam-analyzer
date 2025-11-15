#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { requireEnv } from '../lib/common';
import { StorageStack } from '../lib/storage-stack';
import { WorkflowStack } from '../lib/workflow-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();
const contextEnv = app.node.tryGetContext('env') as string | undefined;
const envName = requireEnv(contextEnv ?? process.env.DEPLOY_ENV ?? 'dev');
const alertEmail = process.env.ALERT_EMAIL;

const defaultEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '111111111111',
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-central-1',
};

const storageStack = new StorageStack(app, 'TrafficCamStorageStack', {
  envName,
  env: defaultEnv,
});

const workflowStack = new WorkflowStack(app, 'TrafficCamWorkflowStack', {
  envName,
  env: defaultEnv,
  detectionsTable: storageStack.detectionsTable,
  camerasTable: storageStack.camerasTable,
  processedBucket: storageStack.processedBucket,
  alertEmail,
});

new ApiStack(app, 'TrafficCamApiStack', {
  envName,
  env: defaultEnv,
  detectionsTable: storageStack.detectionsTable,
  camerasTable: storageStack.camerasTable,
  rawBucket: workflowStack.rawBucket,
  processedBucket: storageStack.processedBucket,
});
