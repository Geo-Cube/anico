"""Nastavení GlitchTipu pro AniCo: převezme výchozí a mění jen to, co nejde přes env.

Ansible ho připojí jako /code/anico_settings.py a kontejner ho načte přes
DJANGO_SETTINGS_MODULE=anico_settings.
"""

from glitchtip.settings import *  # noqa: F401,F403

# Za tunelem allauth skládá návratovou URL pro GitHub s http:// a GitHub ji odmítne.
# GlitchTip je dostupný jen přes https://monitoring.anico.online.
ACCOUNT_DEFAULT_HTTP_PROTOCOL = "https"
