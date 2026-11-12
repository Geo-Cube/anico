"""Idempotent GitHub login bootstrap; runs inside the GlitchTip container via stdin.

Client secret is read from the read-only secret mount, never from argv or this script.
Prints only nonsecret JSON describing what changed.
"""
import json
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'glitchtip.settings')
django.setup()

from allauth.socialaccount.models import SocialApp  # noqa: E402
from django.db import transaction  # noqa: E402

from apps.organizations_ext.constants import OrganizationUserRole  # noqa: E402
from apps.organizations_ext.models import (  # noqa: E402
    Organization,
    OrganizationSocialApp,
    OrganizationUser,
)

with open('/run/secrets/github-oauth.json', encoding='utf8') as handle:
    oauth = json.load(handle)

created = []
updated = []
with transaction.atomic():
    organization, new = Organization.objects.get_or_create(slug='anico', defaults={'name': 'AniCo'})
    if new:
        created.append('organization')
    app, new = SocialApp.objects.get_or_create(
        provider='github',
        name='AniCo GitHub',
        defaults={'client_id': oauth['clientId'], 'secret': oauth['clientSecret']},
    )
    if new:
        created.append('social_app')
    elif (app.client_id, app.secret) != (oauth['clientId'], oauth['clientSecret']):
        app.client_id = oauth['clientId']
        app.secret = oauth['clientSecret']
        app.save(update_fields=['client_id', 'secret'])
        updated.append('social_app')
    # Přihlášení přes tuto aplikaci přidá uživatele do organizace (signál GlitchTipu).
    link, new = OrganizationSocialApp.objects.get_or_create(
        social_app=app,
        defaults={'organization': organization, 'is_public': True},
    )
    if new:
        created.append('organization_social_app')
    elif link.organization_id != organization.pk or not link.is_public:
        link.organization = organization
        link.is_public = True
        link.save(update_fields=['organization', 'is_public'])
        updated.append('organization_social_app')
    # Noví členové přicházejí jako MEMBER; vývojáři potřebují spravovat projekty.
    promoted = OrganizationUser.objects.filter(
        organization=organization,
        role=OrganizationUserRole.MEMBER,
    ).update(role=OrganizationUserRole.ADMIN)

print(json.dumps({'created': created, 'updated': updated, 'promoted': promoted}))
