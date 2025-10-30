#!/usr/bin/env python3
"""
Script to parse all model schemas from fal.ai
Fetches all models from the API and their OpenAPI schemas
"""

import json
import requests
import time
from typing import Dict, List, Any
from pathlib import Path

def fetch_all_models() -> List[Dict[str, Any]]:
    """Fetch all models from fal.ai API with pagination"""
    all_models = []
    page = 1
    
    print("Fetching models from fal.ai API...")
    
    while True:
        url = f"https://fal.ai/api/models?page={page}"
        print(f"Fetching page {page}...")
        
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            items = data.get('items', [])
            all_models.extend(items)
            
            total_pages = data.get('pages', 1)
            print(f"  Got {len(items)} models (page {page}/{total_pages})")
            
            if page >= total_pages:
                break
                
            page += 1
            time.sleep(0.5)  # Be nice to the API
            
        except Exception as e:
            print(f"Error fetching page {page}: {e}")
            break
    
    print(f"\nTotal models fetched: {len(all_models)}")
    return all_models

def fetch_openapi_schema(endpoint_id: str) -> Dict[str, Any]:
    """Fetch OpenAPI schema for a specific model"""
    url = f"https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={endpoint_id}"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error fetching schema for {endpoint_id}: {e}")
        return {}

def parse_input_schema(openapi_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Extract input schema from OpenAPI spec"""
    try:
        components = openapi_schema.get('components', {})
        schemas = components.get('schemas', {})
        
        input_schema = None
        for schema_name, schema_def in schemas.items():
            if 'Input' in schema_name:
                input_schema = schema_def
                break
        
        if not input_schema:
            return {}
        
        properties = input_schema.get('properties', {})
        required = input_schema.get('required', [])
        
        parameters = {}
        for prop_name, prop_def in properties.items():
            param_info = {
                'type': prop_def.get('type'),
                'description': prop_def.get('description', ''),
                'required': prop_name in required,
            }
            
            if 'enum' in prop_def:
                param_info['enum'] = prop_def['enum']
            if 'minimum' in prop_def:
                param_info['minimum'] = prop_def['minimum']
            if 'maximum' in prop_def:
                param_info['maximum'] = prop_def['maximum']
            if 'minLength' in prop_def:
                param_info['minLength'] = prop_def['minLength']
            if 'maxLength' in prop_def:
                param_info['maxLength'] = prop_def['maxLength']
            if 'default' in prop_def:
                param_info['default'] = prop_def['default']
            if 'examples' in prop_def:
                param_info['examples'] = prop_def['examples']
            if 'items' in prop_def:
                param_info['items'] = prop_def['items']
            if 'properties' in prop_def:
                param_info['properties'] = prop_def['properties']
            
            parameters[prop_name] = param_info
        
        return parameters
    except Exception as e:
        print(f"  Error parsing input schema: {e}")
        return {}

def parse_output_schema(openapi_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Extract output schema from OpenAPI spec"""
    try:
        components = openapi_schema.get('components', {})
        schemas = components.get('schemas', {})
        
        output_schema = None
        for schema_name, schema_def in schemas.items():
            if 'Output' in schema_name or 'Response' in schema_name:
                output_schema = schema_def
                break
        
        if not output_schema:
            return {}
        
        properties = output_schema.get('properties', {})
        
        outputs = {}
        for prop_name, prop_def in properties.items():
            output_info = {
                'type': prop_def.get('type'),
                'description': prop_def.get('description', ''),
            }
            
            if 'items' in prop_def:
                output_info['items'] = prop_def['items']
            if 'properties' in prop_def:
                output_info['properties'] = prop_def['properties']
            
            outputs[prop_name] = output_info
        
        return outputs
    except Exception as e:
        print(f"  Error parsing output schema: {e}")
        return {}

def main():
    models = fetch_all_models()
    
    parsed_models = []
    
    print("\nParsing OpenAPI schemas for all models...")
    for i, model in enumerate(models, 1):
        endpoint_id = model.get('id')
        if not endpoint_id:
            continue
        
        print(f"[{i}/{len(models)}] Parsing {endpoint_id}...")
        
        openapi_schema = fetch_openapi_schema(endpoint_id)
        
        if not openapi_schema:
            print(f"  Skipping (no schema available)")
            continue
        
        metadata = openapi_schema.get('info', {}).get('x-fal-metadata', {})
        
        input_params = parse_input_schema(openapi_schema)
        output_params = parse_output_schema(openapi_schema)
        
        parsed_model = {
            'id': endpoint_id,
            'title': model.get('title', ''),
            'category': model.get('category', ''),
            'description': model.get('shortDescription', ''),
            'tags': model.get('tags', []),
            'thumbnailUrl': model.get('thumbnailUrl', ''),
            'playgroundUrl': metadata.get('playgroundUrl', ''),
            'documentationUrl': metadata.get('documentationUrl', ''),
            'licenseType': model.get('licenseType', ''),
            'deprecated': model.get('deprecated', False),
            'unlisted': model.get('unlisted', False),
            'inputParameters': input_params,
            'outputParameters': output_params,
        }
        
        parsed_models.append(parsed_model)
        
        time.sleep(0.3)
    
    output_dir = Path(__file__).parent.parent / 'data'
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / 'fal_models_schemas.json'
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(parsed_models, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Successfully parsed {len(parsed_models)} models")
    print(f"✓ Saved to: {output_file}")
    
    categories = {}
    for model in parsed_models:
        cat = model['category']
        categories[cat] = categories.get(cat, 0) + 1
    
    print("\nModels by category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

if __name__ == '__main__':
    main()
