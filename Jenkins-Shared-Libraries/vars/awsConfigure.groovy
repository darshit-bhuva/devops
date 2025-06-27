#!/usr/bin/env groovy

def call(String accessKeyId, String secretAccessKey, String region, String project) {
  sh """
    echo Started Configuring AWS CLI....
    aws configure set aws_access_key_id ${accessKeyId}
    aws configure set aws_secret_access_key ${secretAccessKey}
    aws configure set default.region ${region}
    aws eks --region ${region} update-kubeconfig --name ${project}
    echo AWS Configured Successfully!
  """
}
