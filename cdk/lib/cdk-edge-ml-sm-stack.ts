import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as iam from '@aws-cdk/aws-iam';
import * as sagemaker from '@aws-cdk/aws-sagemaker';

import { EdgeManagerDeviceConfiguration } from './constructs/EdgeManagerDeviceConfiguration/EdgeManagerDeviceConfiguration';
import { EdgeDeviceRole } from './constructs/EdgeDeviceRole/EdgeDeviceRole';
import { EdgeDeploymentAutomation } from './constructs/EdgeDeploymentAutomation/EdgeDeploymentAutomation';

export class CdkEdgeMlSmStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CloudFormation Parameter to set the project name
    const projectNameParam = new cdk.CfnParameter(this, 'ProjectName', {
      type: 'String',
      description: 'The project name of this project, which defined resource names like the name of the S3 bucket created.',
      allowedPattern: '^[a-z\-]+'
    });

    // The bucket where we save model artifacts and the edge device configuration package
    const s3AssetsBucket = new s3.Bucket(this, 'S3AssetsBucket', {
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      },
      bucketName: `${projectNameParam.valueAsString}-${this.region}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // The device role mapped to the IoT Role Alias which will be created by the SM Edge Manager Fleet (see below)
    const edgeDeviceRole = new EdgeDeviceRole(this, 'EdgeDeviceRole', {assetsBucket: s3AssetsBucket, projectName: projectNameParam.valueAsString});

    // Note that this will create a new IoT Role Alias automatically
    const smDeviceFleet = new sagemaker.CfnDeviceFleet(this, 'SMEdgeDeviceFleet', {
      deviceFleetName: `device-fleet-${projectNameParam.valueAsString}-${this.region}-${this.account}`,
      outputConfig: {
        s3OutputLocation: `s3://${s3AssetsBucket.bucketName}/data/`
      },
      roleArn: edgeDeviceRole.roleArn
    });

    // Define the IoT Things and the Edge Manager Configurations for these IoT Things
    const iotThingName01 = `${projectNameParam.valueAsString}-edge-device-01`;
    const iotThingName02 = `${projectNameParam.valueAsString}-edge-device-02`;
    const iotThingGroupName = 'edge-device-test-cdk-group'

    const edgeManagerDeviceConfig01 = new EdgeManagerDeviceConfiguration(this, 'EdgeManagerDeviceConfig01', {
      assetsBucket: s3AssetsBucket,
      smEdgeDeviceFleet: smDeviceFleet,
      thingName: iotThingName01,
      thingGroupName: iotThingGroupName
    });

    const edgeManagerDeviceConfig02 = new EdgeManagerDeviceConfiguration(this, 'EdgeManagerDeviceConfig02', {
      assetsBucket: s3AssetsBucket,
      smEdgeDeviceFleet: smDeviceFleet,
      thingName: iotThingName02,
      thingGroupName: iotThingGroupName
    });

    // Create a deployment execution role for SageMaker which will be used by SageMaker Services when running the deployment workflow
    const sagemakerExecutionRole = new iam.Role(this, 'SageMakerEdgeDeploymentExecutionRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      inlinePolicies: {
        sagemakerPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sagemaker:*'], //TODO: scope down permissions
              resources: ['*']
            })
          ]
        })
      }
    });

    // Grant access to the project bucket
    s3AssetsBucket.grantReadWrite(sagemakerExecutionRole);

    // Set up the model package groups for the two models. In this example, we use image classification and semantic segmentation
    const imgClassificationModelPackageGroup = new sagemaker.CfnModelPackageGroup(this, 'ImgClassificationModelPackageGroup', {
      modelPackageGroupName: `${projectNameParam.valueAsString}-img-classification`
    });

    const semanticSegmentationModelPackageGroup = new sagemaker.CfnModelPackageGroup(this, 'SemanticSegmentationModelPackageGroup', {
      modelPackageGroupName: `${projectNameParam.valueAsString}-semantic-segmentation`
    });

    // Set up the respective deployment workflows for both of those models
    const imgClassificationEdgeDeploymentAutomation = new EdgeDeploymentAutomation(this, 'ImgClfEdgeDeploymentAutomation', {
      s3Bucket: s3AssetsBucket,
      s3ModelArtifactPrefix: 'models/img-classification',
      iotJobTargetArn: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:thinggroup/${iotThingGroupName}`,
      modelName: 'img-classification',
      modelPackageGroupName: imgClassificationModelPackageGroup.modelPackageGroupName,
      neoCompilationSettings: {
        dataSize: '1,3,224,224',
        framework: 'MXNET',
        targetPlatform: {
          'Os': 'LINUX',
          'Arch': 'X86_64'
        }
      },
      sagemakerExecutionRole: sagemakerExecutionRole
    });

    const semanticSegmentationEdgeDeploymentAutomation = new EdgeDeploymentAutomation(this, 'SemSegEdgeDeploymentAutomation', {
      s3Bucket: s3AssetsBucket,
      s3ModelArtifactPrefix: 'models/semantic-segmentation',
      iotJobTargetArn: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:thinggroup/${iotThingGroupName}`,
      modelName: 'semantic-segmentation',
      modelPackageGroupName: semanticSegmentationModelPackageGroup.modelPackageGroupName,
      neoCompilationSettings: {
        dataSize: '1,3,224,224',
        framework: 'KERAS',
        targetPlatform: {
          'Os': 'LINUX',
          'Arch': 'X86_64'
        }
      },
      sagemakerExecutionRole: sagemakerExecutionRole
    });


  }
}