#!/usr/bin/env groovy

def call(String env, String namespace) {
    sh """
        echo Started Deploying...
        helm upgrade --install ${BUILD_NAME}-${env} helm-chart/ --set=image=$FW_ECR_URL$BUILD_NAME:${GIT_BRANCH}_$CI_COMMIT_SHA -f helm-chart/${env}-values.yaml -n dev --force
        kubectl rollout restart deployment ${BUILD_NAME}-${env} -n dev
        kubectl rollout status -w deployment/${BUILD_NAME}-${env} -n dev
        echo Rollout Successfull!!!!
    """
}
