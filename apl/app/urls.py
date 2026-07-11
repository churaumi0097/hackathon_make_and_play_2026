"""app の API ルーティング。"""

from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("analyze", views.analyze, name="analyze"),
    path("route", views.route, name="route"),
    path("result", views.result, name="result"),
]
