import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Achievement

class RecommendationView(APIView):
    def get(self, request):
        api_key = request.query_params.get('api_key')
        if not api_key:
            return Response({"error": "API Key required"}, status=400)

        # 1. Fetch User Progress from GW2 API
        headers = {"Authorization": f"Bearer {api_key}"}
        user_data_res = requests.get("https://api.guildwars2.com/v2/account/achievements", headers=headers)
        user_achievements = user_data_res.json() # List of {id, current, max, done, bits}

        # 2. Calculate User Affinity (Categorical Weighting)
        # We count completed achievements per category to see what the user likes
        completed_ids = [a['id'] for a in user_achievements if a.get('done')]
        affinity_map = {}
        
        # Pull categories for completed achievements from our local Library
        history = Achievement.objects.filter(gw2_id__in=completed_ids)
        for ach in history:
            affinity_map[ach.category_name] = affinity_map.get(ach.category_name, 0) + 1

        # 3. Generate Recommendations (Exclude already done)
        in_progress = {a['id']: a for a in user_achievements if not a.get('done')}
        potential = Achievement.objects.exclude(gw2_id__in=completed_ids)

        recommendations = {
            "nearly_complete": [],
            "legendary": [],
            "pvp": [],
            "story": [],
            "exploration": []
        }

        for ach in potential:
            # Calculate a base score
            # Bonus for affinity, community importance, and progress
            progress_obj = in_progress.get(ach.gw2_id)
            score = affinity_map.get(ach.category_name, 0)
            
            if ach.community_priority: score += 10
            
            ach_data = {
                "id": ach.gw2_id,
                "name": ach.name,
                "requirement": ach.requirement,
                "category": ach.category_name,
                "progress": progress_obj.get('current', 0) if progress_obj else 0,
                "max": progress_obj.get('max', 0) if progress_obj else 1,
            }

            # Categorize into sections
            if progress_obj and (progress_obj.get('current', 0) / progress_obj.get('max', 1)) > 0.7:
                recommendations["nearly_complete"].append(ach_data)
            
            if ach.is_legendary:
                recommendations["legendary"].append(ach_data)
            elif "Pvp" in ach.flags:
                recommendations["pvp"].append(ach_data)
            elif "Story" in ach.group_name:
                recommendations["story"].append(ach_data)
            elif "Explorer" in ach.category_name:
                recommendations["exploration"].append(ach_data)

        # Sort each list by score (not implemented fully here for brevity)
        return Response(recommendations)