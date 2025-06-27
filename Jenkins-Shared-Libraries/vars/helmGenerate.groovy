#!/usr/bin/env groovy

def call(String namespace) {
  sh """
    echo Started Creating Helm Chart for $namespace namespace...
    mkdir -p helm-chart/templates
    cp -r devops/k8s/templates/* helm-chart/templates
    cp -r devops/k8s/configmap/$namespace-configmap.yaml helm-chart/templates || true
    cp devops/k8s/values/$namespace-values.yaml helm-chart/
    cp devops/k8s/Chart.yaml helm-chart/
    sed -i "s/{namespace}/$namespace/g" helm-chart/Chart.yaml
    echo Helm Chart Generation successful!!!
  """
}