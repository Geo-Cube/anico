"""Validate environment boundaries before Ansible changes any Docker resources."""

import json
from pathlib import Path
import re
import sys


def validate(config):
    expected = {"domain", "rootDirectory", "managementNetwork", "environments"}
    if set(config) != expected:
        raise ValueError("Unexpected or missing foundation configuration fields")
    domain = config["domain"]
    if not isinstance(domain, str) or not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}", domain
    ):
        raise ValueError("Invalid base domain")
    root = Path(config["rootDirectory"])
    if not root.is_absolute() or ".." in root.parts or root.parent != Path("/srv"):
        raise ValueError("rootDirectory must be a dedicated directory directly under /srv")
    if set(config["environments"]) != {"dev", "prod"}:
        raise ValueError("Both dev and prod must be defined")
    names = [config["managementNetwork"]]
    for name, environment in config["environments"].items():
        fields = {"hostname", "project", "appNetwork", "dataNetwork", "databaseVolume"}
        if set(environment) != fields:
            raise ValueError("Unexpected or missing environment fields: " + name)
        expected_host = domain if name == "prod" else "dev." + domain
        if environment["hostname"] != expected_host:
            raise ValueError("Unexpected hostname for " + name)
        if environment["project"] != "anico-" + name:
            raise ValueError("Unexpected Compose project for " + name)
        for key in ("appNetwork", "dataNetwork", "databaseVolume"):
            resource = environment[key]
            if not isinstance(resource, str) or not resource.startswith("anico-" + name + "-"):
                raise ValueError("Resource must belong to its own environment: " + key)
            names.append(resource)
    if any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,62}", name) for name in names):
        raise ValueError("Invalid Docker resource name")
    if len(names) != len(set(names)):
        raise ValueError("Environments and management must not share network or volume names")
    return config


if __name__ == "__main__":
    config = validate(json.loads(Path(sys.argv[1]).read_text()))
    print("Validated dev/prod hostnames, projects, networks, volumes and root directory")
