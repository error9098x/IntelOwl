# Generated by Django 4.1.9 on 2023-05-23 13:18

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("analyzers_manager", "0029_alter_phishtank"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="analyzerconfig",
            options={"ordering": ["name", "disabled"]},
        ),
    ]