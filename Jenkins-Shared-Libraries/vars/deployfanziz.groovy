#!/usr/bin/env groovy

def call(String env, String namespace) {
    sh """
        echo Started Deploying...
        helm upgrade --install ${BUILD_NAME} helm-chart/ --set=image=$FW_ECR_URL$BUILD_NAME:$CI_COMMIT_SHA -f helm-chart/${env}-values.yaml -n ${namespace} --force
        kubectl rollout restart deployment ${BUILD_NAME} -n ${namespace}
        kubectl rollout status -w deployment/${BUILD_NAME} -n ${namespace}
        echo Rollout Successfull!!!!
    """
}
