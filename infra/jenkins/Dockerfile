# Jenkins controller for FundEd's pipeline, configured entirely from files: plugins from plugins.txt,
# settings and the job from casc.yaml. No setup wizard and no clicking through the UI.
FROM jenkins/jenkins:lts-jdk21

USER root

# Python to run the optimizer's tests, curl for the smoke test.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip curl \
    && rm -rf /var/lib/apt/lists/*

# Only the Docker CLI, copied from the official image. Builds run on the host's Docker daemon through
# the mounted socket, so Jenkins does not need a daemon of its own.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY casc.yaml /usr/share/jenkins/ref/casc.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc.yaml
