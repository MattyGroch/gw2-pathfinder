from django.db import models

class Achievement(models.Model):
    # The official GW2 API ID
    gw2_id = models.IntegerField(unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    requirement = models.TextField(blank=True)
    
    # Categorization
    category_name = models.CharField(max_length=100, db_index=True)
    group_name = models.CharField(max_length=100, blank=True)
    
    # Meta data for weighting
    flags = models.JSONField(default=list) # e.g., ["Pvp", "CategoryDisplay"]
    tiers = models.JSONField(default=list)
    rewards = models.JSONField(default=list) # Look for "Mastery" or "Item"
    
    # Our custom "Importance" tags
    is_legendary = models.BooleanField(default=False)
    community_priority = models.BooleanField(default=False)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']