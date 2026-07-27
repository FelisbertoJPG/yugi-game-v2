using UnityEngine;

[RequireComponent(typeof(SphereCollider))]
public class InteractablePoint : MonoBehaviour
{      
    [SerializeField] private float interactionRadius = 2f;
    private SphereCollider collider;

    private void OnDrawGizmosSelected()
    {
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireSphere(transform.position, interactionRadius);
    }
    void Awake()
    {
        collider = GetComponent<SphereCollider>();
        collider.isTrigger = true;
        collider.radius = interactionRadius;
    }

    // Start is called once before the first execution of Update after the MonoBehaviour is created
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        collider.radius = interactionRadius;
    }
}
