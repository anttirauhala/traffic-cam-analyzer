import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export type TrafficCamEnv = 'dev' | 'prod';

export function requireEnv(input: string | undefined): TrafficCamEnv {
  if (input === 'dev' || input === 'prod') {
    return input;
  }
  throw new Error(`Invalid environment: ${input ?? 'undefined'}. Use --context env=dev|prod or set DEPLOY_ENV.`);
}

export function resourcePrefix(env: TrafficCamEnv, stackId: string): string {
  return `traffic-cam-${env}-${stackId}`;
}

export function addStandardTags(scope: IConstruct, env: TrafficCamEnv, stackId: string): void {
  cdk.Tags.of(scope).add('Project', 'traffic-cam');
  cdk.Tags.of(scope).add('Environment', env);
  cdk.Tags.of(scope).add('StackId', stackId);
}
