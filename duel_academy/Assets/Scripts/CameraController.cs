using UnityEngine;
using UnityEngine.InputSystem;

public class CameraController : MonoBehaviour
{
    [Header("Referências")]
    [SerializeField] private Transform cameraTransform;

    [Header("Rotação")]
    [SerializeField] private float mouseSensitivity = 0.15f;
    [SerializeField] private float minPitch = -30f;
    [SerializeField] private float maxPitch = 60f;
    [SerializeField] private bool invertY = false;

    [Header("Cursor")]
    [SerializeField] private bool lockCursorOnStart = true;

    private float yaw;
    private float pitch;

    private void Start()
    {
        Vector3 angles = transform.localEulerAngles;

        yaw = angles.y;
        pitch = angles.x;

        if (pitch > 180f)
        {
            pitch -= 360f;
        }

        if (lockCursorOnStart)
        {
            LockCursor();
        }
    }

    private void LateUpdate()
    {
        HandleMouseLook();
    }

    private void HandleMouseLook()
    {
        if (Mouse.current == null)
        {
            return;
        }

        Vector2 mouseDelta = Mouse.current.delta.ReadValue();

        float mouseX = mouseDelta.x * mouseSensitivity;
        float mouseY = mouseDelta.y * mouseSensitivity;

        yaw += mouseX;
        pitch += invertY ? mouseY : -mouseY;

        pitch = Mathf.Clamp(pitch, minPitch, maxPitch);

        transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);
    }

    private void LockCursor()
    {
        Cursor.lockState = CursorLockMode.Locked;
        Cursor.visible = false;
    }

    private void UnlockCursor()
    {
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
    }
}